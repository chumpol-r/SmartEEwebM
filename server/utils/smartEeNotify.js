// Thin client for the Smart EE LINE relay.
//
// channel='smart' does NOT talk to the LINE Messaging API directly. Instead it
// posts to smarteepro.com's relay, which already owns the binding
// "(gid + pin) -> which LINE group". So we never handle a channel access token
// or a chatId — we just forward a message.
//
//   POST {SMARTEE_NOTIFY_URL}          (application/x-www-form-urlencoded)
//     configure = "gid=<gid>&pin=<pin>&pas=<pas>"
//     message   = "<text>"
//
// Two quirks of this relay, both verified against the live endpoint:
//   1. The API doc advertises multipart/form-data (for the optional imageFile),
//      but we send text only, so application/x-www-form-urlencoded is simpler
//      and works fine.
//   2. The relay rejects REAL newline bytes in `message` (LF/CRLF -> 400 Bad
//      Request) regardless of encoding — even via multipart. It only accepts
//      the literal two-char escape "\n", which it expands to a line break on
//      the LINE side. So we flatten real newlines to "\n" before sending.
//      (This — not the body encoding — was the original cause of the 400s.)
//
// `pas` is a single system-wide API password (env SMARTEE_NOTIFY_PAS). `gid`
// and `pin` come from the user's subscription. Uses Node 20+ global fetch.

const NOTIFY_URL = process.env.SMARTEE_NOTIFY_URL || 'https://smarteepro.com/notify/v4/api/linebot';
const NOTIFY_PAS = process.env.SMARTEE_NOTIFY_PAS || '';

class SmartEeError extends Error {
    constructor(message, { status, code, hint } = {}) {
        super(message);
        this.name = 'SmartEeError';
        this.status = status;
        this.code = code;
        this.hint = hint;
    }
}

function isConfigured() {
    return Boolean(NOTIFY_PAS);
}

// Send one text message to the LINE group bound to (gid, pin) via the relay.
// Returns the relay's response body (text). Throws SmartEeError on failure.
async function sendNotify({ gid, pin, message }) {
    if (!NOTIFY_PAS) {
        throw new SmartEeError('SMARTEE_NOTIFY_PAS is not configured on the server.', {
            status: 500, code: 'not_configured',
        });
    }
    if (gid == null || !pin) {
        throw new SmartEeError('Both Group ID and Pin ID are required.', { status: 400, code: 'bad_request' });
    }

    // `configure` is itself a querystring; it goes in as ONE field value (the
    // relay does its own split on it). URLSearchParams percent-encodes the
    // inner '&'/'=' correctly — matching the verified `curl --data-urlencode`.
    const configure = `gid=${gid}&pin=${pin}&pas=${NOTIFY_PAS}`;
    // The relay rejects real newline bytes (CR/LF/CRLF -> 400) but accepts the
    // literal two-char escape "\n", which it expands to a line break on the LINE
    // side. So flatten any real newlines to "\n" before sending.
    const safeMessage = String(message ?? '').replace(/\r\n?|\n/g, '\\n');
    const body = new URLSearchParams();
    body.set('configure', configure);
    body.set('message', safeMessage);

    let res;
    try {
        res = await fetch(NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
    } catch (networkErr) {
        throw new SmartEeError("Couldn't reach the Smart EE relay — check the server's internet connection.", {
            status: 0, code: 'network', hint: networkErr.message,
        });
    }

    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
        // Log on the server so the operator sees what the relay actually said.
        console.error(`[smartEeNotify] POST -> ${res.status}`, bodyText.slice(0, 500));
        const code = (res.status >= 400 && res.status < 500) ? 'rejected' : 'relay_error';
        throw new SmartEeError(
            `The Smart EE relay rejected the request (${res.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
            { status: res.status, code, hint: 'Check that the Group ID and Pin ID are correct and still active.' }
        );
    }
    return bodyText;
}

module.exports = { SmartEeError, sendNotify, isConfigured, NOTIFY_URL };
