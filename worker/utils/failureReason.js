// Human-friendly delivery failure reasons (English, for international use).
// ---------------------------------------------------------------------------
// Each notification channel fails for different technical reasons (HTTP codes,
// library error codes, network errors). The dispatchers capture the raw error;
// this module turns it into one short, end-user-readable sentence that gets
// stored in NotifyLog.fail_reason and shown verbatim on the Notify Log page.
//
// Design rules:
//   * English only — the column is meant to be understandable across teams.
//   * Each message is prefixed with the channel ("Web Push:", "LINE:",
//     "Smart EE:") so a single column can serve all three dispatchers.
//   * Keep every message <= 255 chars (the column width). Be specific about
//     what the USER can do, not about internals.
//   * Pure / side-effect-free so it stays trivially testable.

const MAX_LEN = 255;

function clamp(s) {
    const str = String(s || '');
    return str.length > MAX_LEN ? str.slice(0, MAX_LEN - 1) + '…' : str;
}

// ---- Web Push (web-push library: err.statusCode / err.code) --------------
// We additionally recognise code 'bad_subscription' which the dispatcher sets
// when the stored subscription JSON can't be parsed.
function webpushReason(err) {
    const status = err && err.statusCode;
    const code = err && err.code;
    let msg;
    if (code === 'bad_subscription') {
        msg = 'Web Push: the saved subscription data is corrupted. Ask the user to re-enable notifications.';
    } else if (status === 404 || status === 410) {
        msg = 'Web Push: the device is no longer subscribed (it was removed or expired). Ask the user to re-enable notifications.';
    } else if (code === 'ETIMEDOUT') {
        msg = 'Web Push: delivery timed out — the device may be offline or have no internet.';
    } else if (status === 401 || status === 403) {
        msg = 'Web Push: the notification service is misconfigured (VAPID keys). Please contact the administrator.';
    } else if (status === 413) {
        msg = 'Web Push: the notification message is too large to deliver.';
    } else if (status === 429) {
        msg = 'Web Push: too many notifications were sent — temporarily rate-limited. It will be retried.';
    } else {
        msg = `Web Push: delivery failed${status ? ` (HTTP ${status})` : ''}. Please contact the administrator.`;
    }
    return clamp(msg);
}

// ---- Aggregate several per-device web push failures into one line --------
// A single NotifyLog row can target many devices; they may fail for different
// reasons. If they all share one reason, use it; otherwise say so plainly.
function webpushAggregateReason(errors) {
    const reasons = [...new Set((errors || []).map(webpushReason))];
    if (reasons.length === 0) return clamp('Web Push: delivery failed. Please contact the administrator.');
    if (reasons.length === 1) return reasons[0];
    return clamp('Web Push: delivery failed to all target devices for multiple reasons (e.g. unsubscribed and/or offline).');
}

// ---- LINE (utils/lineApi LineApiError: err.code / err.status) ------------
function lineReason(err) {
    const code = err && err.code;
    const status = err && err.status;
    let msg;
    switch (code) {
        case 'invalid_token':
            msg = 'LINE: the channel access token is invalid or has expired. Please reconnect LINE.';
            break;
        case 'forbidden':
            msg = 'LINE: the token cannot access this target. Reconnect using a Messaging API channel.';
            break;
        case 'chat_not_found':
            msg = 'LINE: the bot is not in the target group or room anymore. Re-invite the bot and reconnect.';
            break;
        case 'rate_limited':
            msg = 'LINE: temporarily rate-limited by LINE. It will be retried shortly.';
            break;
        case 'network':
            msg = "LINE: couldn't reach the LINE API — check the server's internet connection.";
            break;
        case 'bad_request':
            msg = 'LINE: the request was rejected as invalid by LINE.';
            break;
        default:
            msg = `LINE: delivery failed${status ? ` (HTTP ${status})` : ''}. Please reconnect LINE or contact the administrator.`;
    }
    return clamp(msg);
}

// ---- Smart EE relay (utils/smartEeNotify SmartEeError: err.code/err.status)
function smartReason(err) {
    const code = err && err.code;
    const status = err && err.status;
    let msg;
    switch (code) {
        case 'not_configured':
            msg = 'Smart EE: the notification relay is not configured on the server. Please contact the administrator.';
            break;
        case 'network':
            msg = "Smart EE: couldn't reach the relay — check the server's internet connection.";
            break;
        case 'rejected':
            msg = 'Smart EE: the relay rejected the request — the Group ID or Pin may be wrong or inactive. Please reconnect.';
            break;
        case 'relay_error':
            msg = 'Smart EE: the relay server had an error. It will be retried shortly.';
            break;
        case 'bad_request':
            msg = 'Smart EE: Group ID and Pin are required. Please reconnect.';
            break;
        default:
            msg = `Smart EE: delivery failed${status ? ` (HTTP ${status})` : ''}. Please reconnect or contact the administrator.`;
    }
    return clamp(msg);
}

module.exports = {
    MAX_LEN,
    webpushReason,
    webpushAggregateReason,
    lineReason,
    smartReason,
};
