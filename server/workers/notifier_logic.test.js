// Unit tests for server/workers/notifier_logic.js
// Run:  npm test     (or: node --test server/workers/notifier_logic.test.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    severityOf,
    toNumber,
    extractFirstJsonObject,
    enrichPayload,
    pickTriggeredLevel,
    configForLevel,
    decideAction,
} = require('./notifier_logic');

// ---------------------------------------------------------------------------
// severityOf
// ---------------------------------------------------------------------------
test('severityOf: returns 2 for extreme levels', () => {
    assert.equal(severityOf('Very High'), 2);
    assert.equal(severityOf('Very Low'), 2);
});

test('severityOf: returns 1 for moderate levels', () => {
    assert.equal(severityOf('High'), 1);
    assert.equal(severityOf('Low'), 1);
});

test('severityOf: returns 0 for Normal/unknown/null', () => {
    assert.equal(severityOf('Normal'), 0);
    assert.equal(severityOf('Bogus'), 0);
    assert.equal(severityOf(null), 0);
    assert.equal(severityOf(undefined), 0);
});

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------
test('toNumber: returns null for missing values', () => {
    assert.equal(toNumber(null), null);
    assert.equal(toNumber(undefined), null);
    assert.equal(toNumber(''), null);
});

test('toNumber: parses plain numbers', () => {
    assert.equal(toNumber(0), 0);
    assert.equal(toNumber(-1.5), -1.5);
    assert.equal(toNumber(12345.67), 12345.67);
});

test('toNumber: parses numeric strings', () => {
    assert.equal(toNumber('123'), 123);
    assert.equal(toNumber('220.5'), 220.5);
    assert.equal(toNumber('-0.92'), -0.92);
});

test('toNumber: rejects garbage and non-finite values', () => {
    assert.equal(toNumber('abc'), null);
    assert.equal(toNumber(NaN), null);
    assert.equal(toNumber(Infinity), null);
    assert.equal(toNumber(-Infinity), null);
    assert.equal(toNumber({}), null);
});

// ---------------------------------------------------------------------------
// extractFirstJsonObject
// ---------------------------------------------------------------------------
test('extractFirstJsonObject: returns clean JSON for clean input', () => {
    assert.equal(extractFirstJsonObject('{"a":1}'), '{"a":1}');
});

test('extractFirstJsonObject: tolerates leading and trailing garbage', () => {
    assert.equal(extractFirstJsonObject('garbage{"a":1}trailing'), '{"a":1}');
});

test('extractFirstJsonObject: handles nested braces', () => {
    assert.equal(
        extractFirstJsonObject('{"a":{"b":2},"c":3}xx'),
        '{"a":{"b":2},"c":3}'
    );
});

test('extractFirstJsonObject: handles braces inside strings', () => {
    assert.equal(
        extractFirstJsonObject('{"msg":"a}b{c","v":1}'),
        '{"msg":"a}b{c","v":1}'
    );
});

test('extractFirstJsonObject: handles escaped quotes inside strings', () => {
    const out = extractFirstJsonObject('{"msg":"he said \\"hi\\""}');
    assert.equal(out, '{"msg":"he said \\"hi\\""}');
});

test('extractFirstJsonObject: throws on missing object', () => {
    assert.throws(() => extractFirstJsonObject('no braces here'), /No JSON object/);
});

test('extractFirstJsonObject: throws on incomplete object', () => {
    assert.throws(() => extractFirstJsonObject('{"a":1'), /Incomplete/);
});

// ---------------------------------------------------------------------------
// enrichPayload — VoltP-avr / Amp-avr derivation
// ---------------------------------------------------------------------------
test('enrichPayload: computes VoltP-avr from VoltP1/2/3', () => {
    const obj = { VoltP1: 220, VoltP2: 222, VoltP3: 218 };
    enrichPayload(obj);
    assert.equal(obj['VoltP-avr'], 220);
});

test('enrichPayload: computes Amp-avr from Amp1/2/3', () => {
    const obj = { Amp1: 10, Amp2: 12, Amp3: 14 };
    enrichPayload(obj);
    assert.equal(obj['Amp-avr'], 12);
});

test('enrichPayload: does NOT override existing VoltP-avr from device', () => {
    const obj = { VoltP1: 220, VoltP2: 220, VoltP3: 220, 'VoltP-avr': 999 };
    enrichPayload(obj);
    assert.equal(obj['VoltP-avr'], 999);  // device wins
});

test('enrichPayload: skips when any phase is missing', () => {
    const obj = { VoltP1: 220, VoltP2: 220 };  // VoltP3 missing
    enrichPayload(obj);
    assert.equal(obj['VoltP-avr'], undefined);
});

test('enrichPayload: skips when a phase is non-numeric', () => {
    const obj = { Amp1: 10, Amp2: 'bad', Amp3: 14 };
    enrichPayload(obj);
    assert.equal(obj['Amp-avr'], undefined);
});

test('enrichPayload: parses numeric strings before averaging', () => {
    const obj = { VoltP1: '220', VoltP2: '222', VoltP3: '218' };
    enrichPayload(obj);
    assert.equal(obj['VoltP-avr'], 220);
});

test('enrichPayload: treats empty string as missing (skips average)', () => {
    const obj = { Amp1: 10, Amp2: '', Amp3: 14 };
    enrichPayload(obj);
    assert.equal(obj['Amp-avr'], undefined);
});

test('enrichPayload: returns the same object reference (mutation in place)', () => {
    const obj = { VoltP1: 1, VoltP2: 2, VoltP3: 3 };
    assert.equal(enrichPayload(obj), obj);
});

test('enrichPayload: safe with null / non-object input', () => {
    assert.equal(enrichPayload(null), null);
    assert.equal(enrichPayload(undefined), undefined);
});

test('enrichPayload: does not add fields when neither VoltP* nor Amp* present', () => {
    const obj = { Temperature: 25, Humidity: 60 };
    enrichPayload(obj);
    assert.deepEqual(obj, { Temperature: 25, Humidity: 60 });
});

// ---------------------------------------------------------------------------
// pickTriggeredLevel — threshold matching
// ---------------------------------------------------------------------------
// Fixture mirroring METER3/KVAR config from the user's data.
const KVAR_CONFIG = [
    { level: 'Very Low',  point: 8.20, delay: 10, message: 'vl' },
    { level: 'Low',       point: 8.30, delay: 10, message: 'l'  },
    { level: 'Normal',    point: 0.00, delay: 10, message: 'n'  },
    { level: 'High',      point: 8.40, delay: 10, message: 'h'  },
    { level: 'Very High', point: 8.50, delay: 10, message: 'vh' },
];

test('pickTriggeredLevel: value above Very High threshold => Very High', () => {
    assert.equal(pickTriggeredLevel(10.0, KVAR_CONFIG).level, 'Very High');
});

test('pickTriggeredLevel: value exactly at Very High threshold => Very High (inclusive)', () => {
    assert.equal(pickTriggeredLevel(8.50, KVAR_CONFIG).level, 'Very High');
});

test('pickTriggeredLevel: value at High threshold but below Very High => High', () => {
    assert.equal(pickTriggeredLevel(8.40, KVAR_CONFIG).level, 'High');
    assert.equal(pickTriggeredLevel(8.45, KVAR_CONFIG).level, 'High');
});

test('pickTriggeredLevel: value between Low and High => Normal (returns null)', () => {
    assert.equal(pickTriggeredLevel(8.35, KVAR_CONFIG), null);
});

test('pickTriggeredLevel: value at Low threshold => Low', () => {
    assert.equal(pickTriggeredLevel(8.30, KVAR_CONFIG).level, 'Low');
});

test('pickTriggeredLevel: value at Very Low threshold => Very Low (more severe wins)', () => {
    assert.equal(pickTriggeredLevel(8.20, KVAR_CONFIG).level, 'Very Low');
});

test('pickTriggeredLevel: value far below Very Low => Very Low', () => {
    assert.equal(pickTriggeredLevel(0, KVAR_CONFIG).level, 'Very Low');
});

test('pickTriggeredLevel: empty configs => null', () => {
    assert.equal(pickTriggeredLevel(100, []), null);
    assert.equal(pickTriggeredLevel(100, null), null);
});

test('pickTriggeredLevel: only upper-side configured', () => {
    const cfg = [
        { level: 'High',      point: 80 },
        { level: 'Very High', point: 90 },
    ];
    assert.equal(pickTriggeredLevel(85, cfg).level, 'High');
    assert.equal(pickTriggeredLevel(50, cfg), null);
    assert.equal(pickTriggeredLevel(0, cfg), null);   // no lower side
});

test('pickTriggeredLevel: only lower-side configured', () => {
    const cfg = [
        { level: 'Low',      point: 10 },
        { level: 'Very Low', point: 5  },
    ];
    assert.equal(pickTriggeredLevel(7, cfg).level, 'Low');
    assert.equal(pickTriggeredLevel(3, cfg).level, 'Very Low');
    assert.equal(pickTriggeredLevel(50, cfg), null);  // no upper side
});

test('pickTriggeredLevel: ignores configs with null point', () => {
    const cfg = [
        { level: 'Very High', point: null },
        { level: 'High',      point: 80   },
    ];
    assert.equal(pickTriggeredLevel(95, cfg).level, 'High');  // VH skipped
});

// ---------------------------------------------------------------------------
// configForLevel
// ---------------------------------------------------------------------------
test('configForLevel: returns exact match when present', () => {
    const c = configForLevel(KVAR_CONFIG, 'High');
    assert.equal(c.point, 8.40);
});

test('configForLevel: falls back to first config when level missing', () => {
    const c = configForLevel(KVAR_CONFIG, 'Bogus');
    assert.equal(c.level, 'Very Low');  // first entry
});

test('configForLevel: returns null for empty / null', () => {
    assert.equal(configForLevel([], 'High'), null);
    assert.equal(configForLevel(null, 'High'), null);
});

// ---------------------------------------------------------------------------
// decideAction — state machine
// ---------------------------------------------------------------------------
const T0 = 1_700_000_000_000;  // arbitrary fixed epoch ms for deterministic tests

test('decideAction: Normal + no prior state => noop', () => {
    const action = decideAction(null, 8.35, KVAR_CONFIG, T0);
    assert.equal(action.action, 'noop');
});

test('decideAction: first alarm breach starts the debounce timer', () => {
    const action = decideAction(null, 9.0, KVAR_CONFIG, T0);
    assert.equal(action.action, 'startTimer');
    assert.equal(action.newState.currentLevel, 'Very High');
    assert.equal(action.newState.peakLevel, 'Very High');
    assert.equal(action.newState.fired, false);
    assert.equal(action.newState.since, T0);
});

test('decideAction: same level before delay elapsed => updateLevel, no fire', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        false,
        raiseLogId:   null,
        raisedAt:     null,
        normalSince:  null,
        lastSeen:     T0,
    };
    const action = decideAction(prev, 9.0, KVAR_CONFIG, T0 + 5_000);  // 5s in, delay is 10s
    assert.equal(action.action, 'updateLevel');
    assert.equal(action.newState.fired, false);
});

test('decideAction: same level after delay elapsed => fire (raise)', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        false,
        raiseLogId:   null,
        raisedAt:     null,
        normalSince:  null,
        lastSeen:     T0,
    };
    const action = decideAction(prev, 9.0, KVAR_CONFIG, T0 + 10_000);
    assert.equal(action.action, 'fire');
    assert.equal(action.eventType, 'raise');
    assert.equal(action.level, 'Very High');
    assert.equal(action.correlationId, null);
});

test('decideAction: escalation from High to Very High resets debounce, then fires escalate', () => {
    // Already raised at High level (logId=100)
    const prev = {
        currentLevel: 'High',
        peakLevel:    'High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  null,
        lastSeen:     T0,
    };
    // Value jumps to Very High band — should reset timer for escalate event
    const step1 = decideAction(prev, 9.0, KVAR_CONFIG, T0 + 30_000);
    assert.equal(step1.action, 'updateLevel');
    assert.equal(step1.newState.peakLevel, 'Very High');
    assert.equal(step1.newState.fired, false);
    assert.equal(step1.newState.raiseLogId, 100);   // raise lineage kept

    // After another 10s of Very High, escalate should fire
    const step2 = decideAction(step1.newState, 9.0, KVAR_CONFIG, T0 + 40_000);
    assert.equal(step2.action, 'fire');
    assert.equal(step2.eventType, 'escalate');
    assert.equal(step2.correlationId, 100);
});

test('decideAction: de-escalation Very High -> High does NOT fire (silent)', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  null,
        lastSeen:     T0,
    };
    const action = decideAction(prev, 8.45, KVAR_CONFIG, T0 + 60_000);
    assert.equal(action.action, 'updateLevel');
    assert.equal(action.newState.currentLevel, 'High');
    assert.equal(action.newState.peakLevel, 'Very High');   // peak preserved
    assert.equal(action.newState.fired, true);              // still considered fired
});

test('decideAction: Normal after alarm starts the clear timer', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  null,
        lastSeen:     T0,
    };
    const action = decideAction(prev, 8.35, KVAR_CONFIG, T0 + 30_000);
    assert.equal(action.action, 'startClearTimer');
    assert.equal(action.newState.normalSince, T0 + 30_000);
});

test('decideAction: Normal sustained past clear delay => clear', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  T0 + 30_000,
        lastSeen:     T0 + 30_000,
    };
    const action = decideAction(prev, 8.35, KVAR_CONFIG, T0 + 40_000);
    assert.equal(action.action, 'clear');
    assert.equal(action.correlationId, 100);
    assert.equal(action.peakLevel, 'Very High');
});

test('decideAction: value re-enters alarm cancels the clear timer', () => {
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  T0 + 30_000,   // clear timer started
        lastSeen:     T0 + 30_000,
    };
    const action = decideAction(prev, 9.0, KVAR_CONFIG, T0 + 32_000);
    assert.equal(action.action, 'updateLevel');
    assert.equal(action.newState.normalSince, null);   // cancelled
});

test('decideAction: bouncing Normal back to alarm before clear delay does NOT clear', () => {
    // Sequence: alarm fired -> Normal (5s) -> alarm again -> stays at peak
    const prev = {
        currentLevel: 'Very High',
        peakLevel:    'Very High',
        since:        T0,
        fired:        true,
        raiseLogId:   100,
        raisedAt:     T0,
        normalSince:  null,
        lastSeen:     T0,
    };
    const a1 = decideAction(prev, 8.35, KVAR_CONFIG, T0 + 30_000);  // Normal
    assert.equal(a1.action, 'startClearTimer');
    const a2 = decideAction(a1.newState, 9.0, KVAR_CONFIG, T0 + 33_000);  // back to alarm
    assert.equal(a2.action, 'updateLevel');
    assert.equal(a2.newState.fired, true);                  // still fired
    assert.equal(a2.newState.normalSince, null);            // clear cancelled
});
