// Pure logic for the MQTT notifier worker — extracted so it can be unit-tested
// without an MQTT broker or database. Anything here must remain side-effect-free
// (no I/O, no `new Date()`, no `Date.now()` — accept time arguments instead).
//
// Tested by: server/workers/notifier_logic.test.js
// Used by:   server/workers/mqttNotifier.js

// Severity ordering. Both Very High and Very Low are level-2 "extreme"; High
// and Low are level-1 "moderate". Used to decide whether a level change is
// an escalation (worth logging) or a de-escalation (silent).
const SEVERITY = Object.freeze({
    'Very High': 2,
    'Very Low':  2,
    'High':      1,
    'Low':       1,
});

function severityOf(level) {
    return SEVERITY[level] || 0;
}

// Pull a clean number out of an arbitrary value. Returns null for missing,
// empty, or non-finite values so callers can `if (v === null) skip`.
function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Parse the first complete JSON object found in a string. Tolerates garbage
// before or after the object (some devices append checksums, etc.).
function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start === -1) throw new Error('No JSON object found');
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error('Incomplete JSON object');
}

// Add server-side derived fields to the parsed payload. The MQTT device only
// sends per-phase voltages and currents; the worker fills in the 3-phase
// averages so NotifyConfig entries for VoltP-avr / Amp-avr can be evaluated.
//
// Rules:
//   * If the device already sent the *-avr field, do NOT overwrite it (device
//     wins — it might use a different averaging method).
//   * All three inputs must be present and numeric, otherwise the average is
//     skipped (we don't silently treat missing phases as 0).
//   * Returns the same object reference (mutated in place) for chaining.
function enrichPayload(obj) {
    if (obj == null || typeof obj !== 'object') return obj;

    // VoltP-avr = mean(VoltP1, VoltP2, VoltP3)
    if (obj['VoltP-avr'] === undefined) {
        const v1 = toNumber(obj.VoltP1);
        const v2 = toNumber(obj.VoltP2);
        const v3 = toNumber(obj.VoltP3);
        if (v1 !== null && v2 !== null && v3 !== null) {
            obj['VoltP-avr'] = (v1 + v2 + v3) / 3;
        }
    }

    // Amp-avr = mean(Amp1, Amp2, Amp3)
    if (obj['Amp-avr'] === undefined) {
        const a1 = toNumber(obj.Amp1);
        const a2 = toNumber(obj.Amp2);
        const a3 = toNumber(obj.Amp3);
        if (a1 !== null && a2 !== null && a3 !== null) {
            obj['Amp-avr'] = (a1 + a2 + a3) / 3;
        }
    }

    return obj;
}

// Given a numeric value and the list of configured levels for a single
// (serial, dbkey), pick the most severe level whose threshold the value
// breaches. Returns null if the value sits in the Normal band.
//
// Tie-breaking: upper-side (Very High / High) is checked first because most
// alarms are over-limit. If a value is somehow >= Very High AND <= Very Low
// (impossible in practice unless Model B is violated), upper wins.
function pickTriggeredLevel(value, configs) {
    if (!Array.isArray(configs) || configs.length === 0) return null;
    const byLevel = {};
    for (const c of configs) byLevel[c.level] = c;

    const vh = byLevel['Very High'];
    const hi = byLevel['High'];
    const lo = byLevel['Low'];
    const vl = byLevel['Very Low'];

    if (vh && vh.point != null && value >= vh.point) return vh;
    if (hi && hi.point != null && value >= hi.point) return hi;
    if (vl && vl.point != null && value <= vl.point) return vl;
    if (lo && lo.point != null && value <= lo.point) return lo;
    return null;
}

// Return the config row matching a specific level, falling back to the first
// available config for the same (serial, dbkey) pair. Used to attribute
// `cleared` events to the original raise's message / alarmType.
function configForLevel(configs, level) {
    if (!Array.isArray(configs) || configs.length === 0) return null;
    return configs.find(c => c.level === level) || configs[0];
}

// Pure state-transition decision. Given the previous state and a new
// (value, configs, now) reading, return the action the worker should take.
// The worker layer is responsible for the actual DB insert and for writing
// back the returned `newState`. All time is in milliseconds.
//
// Returned shapes:
//   { action: 'noop' }                                              — nothing to do
//   { action: 'startTimer',  newState }                             — first breach, debounce begun
//   { action: 'fire',  eventType, level, correlationId, newState } — emit raise/escalate
//   { action: 'updateLevel', newState }                             — de-escalation, no log
//   { action: 'startClearTimer', newState }                         — value back in Normal, awaiting clear delay
//   { action: 'clear', correlationId, peakLevel }                   — emit cleared, caller deletes state
//
// `newState` is undefined for `clear` to signal "delete the entry".
function decideAction(prev, value, configs, now) {
    const triggered = pickTriggeredLevel(value, configs);

    // ---- Branch A: value is in Normal band -------------------------------
    if (!triggered) {
        if (!prev) return { action: 'noop' };

        const updated = { ...prev, lastSeen: now };
        if (updated.normalSince == null) {
            updated.normalSince = now;
            return { action: 'startClearTimer', newState: updated };
        }

        const clearCfg = configForLevel(configs, prev.peakLevel);
        const clearDelayMs = ((clearCfg && clearCfg.delay) || 0) * 1000;

        if (now - updated.normalSince >= clearDelayMs) {
            return {
                action: 'clear',
                correlationId: prev.raiseLogId,
                peakLevel: prev.peakLevel,
            };
        }
        return { action: 'noop', newState: updated };
    }

    // ---- Branch B: value is in an alarm level ----------------------------
    // Cancel any pending clear because the value re-entered alarm territory.
    const base = prev ? { ...prev, normalSince: null, lastSeen: now } : null;

    // B1. First breach (no prior state).
    if (!base) {
        const newState = {
            currentLevel: triggered.level,
            peakLevel:    triggered.level,
            since:        now,
            fired:        false,
            raiseLogId:   null,
            raisedAt:     null,
            normalSince:  null,
            lastSeen:     now,
        };
        return { action: 'startTimer', newState };
    }

    // B2. Severity comparison drives escalation vs silent update.
    const newSeverity  = severityOf(triggered.level);
    const peakSeverity = severityOf(base.peakLevel);
    const isNewPeak    = newSeverity > peakSeverity;

    if (isNewPeak) {
        base.currentLevel = triggered.level;
        base.peakLevel    = triggered.level;
        base.since        = now;
        base.fired        = false;       // re-arm debounce for the escalate event
    } else {
        base.currentLevel = triggered.level;
    }

    // B3. Fire when the debounce delay has elapsed and we haven't fired yet.
    if (!base.fired) {
        const delayMs = (triggered.delay || 0) * 1000;
        if (now - base.since >= delayMs) {
            const fireCfg = configForLevel(configs, base.peakLevel) || triggered;
            const isRaise = base.raiseLogId == null;
            return {
                action:        'fire',
                eventType:     isRaise ? 'raise' : 'escalate',
                level:         base.peakLevel,
                cfg:           fireCfg,
                correlationId: isRaise ? null : base.raiseLogId,
                newState:      base,    // caller patches in raiseLogId after insert
            };
        }
    }

    return { action: 'updateLevel', newState: base };
}

module.exports = {
    SEVERITY,
    severityOf,
    toNumber,
    extractFirstJsonObject,
    enrichPayload,
    pickTriggeredLevel,
    configForLevel,
    decideAction,
};
