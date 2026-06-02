import React, { useEffect, useMemo, useState } from 'react';
import {
    X, Bell, BellOff, Sparkles, MessageCircle, Crown, Check, CheckCircle2,
    ArrowRight, Loader2, Shield, Eye, EyeOff, Copy, Info, AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import LineCredentialsGuide from './LineCredentialsGuide.jsx';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

function maskSecret(v) {
    if (!v) return '';
    if (v.length <= 16) return '•'.repeat(v.length);
    return v.slice(0, 10) + '•'.repeat(Math.min(24, v.length - 20)) + v.slice(-10);
}

// ---------- Tier definitions ----------
const TIERS = [
    {
        id: 'free',
        name: 'Web Push',
        price: 'Free · for everyone',
        badge: null,
        Icon: Bell,
        accent: 'from-blue-500 to-cyan-500',
        ringSelected: 'ring-blue-500/30 border-blue-500',
        cta: 'Enable Web Push',
        features: [
            'Real-time browser push',
            'Available to all users & roles',
            'Multi-device subscriptions',
            'Instant delivery, no setup',
        ],
    },
    {
        id: 'smart',
        name: 'Smart EE Notification',
        price: 'Pro · advanced workspace',
        badge: '',
        Icon: Sparkles,
        accent: 'from-violet-500 to-pink-500',
        ringSelected: 'ring-violet-500/30 border-violet-500',
        cta: 'Connect Smart EE',
        features: [
            'AI-driven anomaly & trend detection',
            'Custom thresholds per metric & device',
            'Scheduled digests (hourly/daily/weekly)',
            'Email, in-app & webhook channels',
            'Team routing with on-call rotations',
        ],
    },
    {
        id: 'line',
        name: 'LINE Bot Notification',
        price: 'Enterprise · for business teams',
        Icon: MessageCircle,
        accent: 'from-green-500 to-emerald-600',
        ringSelected: 'ring-green-500/30 border-green-500',
        cta: 'Connect LINE Bot',
        features: [
            'Direct delivery to LINE rooms & groups',
            'Encrypted credential storage',
            'Includes every Smart EE & Web Push feature',
            'Unlimited recipients',
            'Delivery analytics & retry logs',
        ],
    },
];

// ---------- SecretField ----------
function SecretField({ id, label, hint, value, onChange, visible, onToggle, onCopy, copied, placeholder, guide }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <label htmlFor={id} className="text-sm font-medium text-slate-200">
                    {label}
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    <Shield size={10} /> Encrypted
                </span>
            </div>
            {guide && <div className="pt-0.5">{guide}</div>}
            <div className="relative">
                <input
                    id={id}
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                        'w-full pl-3 pr-24 py-2.5 text-sm font-mono',
                        'bg-slate-900 border border-slate-700 rounded-lg text-white',
                        'placeholder:text-slate-500 placeholder:font-sans',
                        'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
                        'transition-colors'
                    )}
                />
                <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={onCopy}
                        disabled={!value}
                        title="Copy to clipboard"
                        className={cn(
                            'p-1.5 rounded-md transition-colors',
                            'text-slate-400 hover:text-white hover:bg-slate-700',
                            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                        )}
                    >
                        {copied
                            ? <CheckCircle2 size={16} className="text-emerald-400" />
                            : <Copy size={16} />}
                    </button>
                    <button
                        type="button"
                        onClick={onToggle}
                        title={visible ? 'Hide value' : 'Show value'}
                        className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </div>
            {value && !visible && (
                <p className="text-xs font-mono text-slate-500 truncate">
                    Preview: {maskSecret(value)}
                </p>
            )}
            {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
    );
}

// ---------- ConnectedSummary ----------
// Locked, read-only view shown when a smart/line channel is already connected.
// Surfaces the (sanitized) destination the backend stored. These channels can
// only be managed elsewhere — there is no reconnect/disconnect here.
function ConnectedSummary({ title, rows, verifiedAt, notice, testResult }) {
    const verified = verifiedAt
        ? new Date(verifiedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null;
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 p-5 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={18} className="text-emerald-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-white">{title} — Connected</h4>
                    <p className="mt-1 text-sm text-slate-300">
                        This channel is already active for your account.
                    </p>
                    <dl className="mt-3 space-y-1.5">
                        {rows.filter(r => r.value).map((r) => (
                            <div key={r.label} className="flex items-baseline gap-2 text-xs">
                                <dt className="text-slate-400 shrink-0">{r.label}</dt>
                                <dd className="font-mono text-slate-200 truncate">{r.value}</dd>
                            </div>
                        ))}
                        {verified && (
                            <div className="flex items-baseline gap-2 text-xs">
                                <dt className="text-slate-400 shrink-0">Verified</dt>
                                <dd className="text-slate-300">{verified}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>

            {notice && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40">
                    <AlertTriangle size={16} className="text-amber-300 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-100/90 leading-relaxed">{notice}</p>
                </div>
            )}

            {testResult && (
                <div className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border',
                    testResult.ok ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-rose-500/10 border-rose-500/40'
                )}>
                    {testResult.ok
                        ? <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
                        : <X size={16} className="text-rose-300 mt-0.5 shrink-0" />}
                    <div className={cn('text-xs whitespace-pre-line', testResult.ok ? 'text-emerald-100' : 'text-rose-200')}>
                        {testResult.message}
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------- ConfirmDialog ----------
// Small nested confirmation overlay (stacks above the subscription modal).
function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }) {
    if (!open) return null;
    return (
        <div
            role="alertdialog"
            aria-modal="true"
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
        >
            <div onClick={onCancel} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
            <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-[var(--shadow-elevated)] p-6 animate-scale-in">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
                        <AlertTriangle size={20} className="text-amber-300" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white">{title}</h3>
                        <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">{body}</p>
                    </div>
                </div>
                <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-10 px-4 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="h-10 px-5 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg hover:-translate-y-px active:translate-y-0 transition-all cursor-pointer"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------- ConnectSuccessTest ----------
// Post-connect success view (smart/line). Confirms the channel saved; the
// optional, explicit test send lives in the modal footer.
function ConnectSuccessTest({ channel, summary, testResult }) {
    const identity = channel === 'line'
        ? (() => {
            const bot = summary?.bot?.displayName || summary?.bot?.basicId || 'your bot';
            const dest = summary?.chat?.displayName
                || (summary?.chat?.type === 'group' ? 'your group'
                    : summary?.chat?.type === 'room' ? 'your room' : 'your chat');
            return `${bot} → ${dest}`;
        })()
        : summary?.groupId ? `Group ID ${summary.groupId}` : null;

    const blurb = channel === 'line'
        ? 'We verified your bot and destination without sending a message. Send a test anytime to confirm delivery.'
        : 'Your Group ID and Pin are stored securely. Send a test notification to confirm messages reach your LINE group.';

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 p-5 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={18} className="text-emerald-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-white">Connected successfully</h4>
                    <p className="mt-1 text-sm text-slate-300">{blurb}</p>
                    {identity && (
                        <p className="mt-2 text-xs font-mono text-slate-200 truncate">{identity}</p>
                    )}
                </div>
            </div>

            {testResult && (
                <div className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border',
                    testResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/40'
                        : 'bg-rose-500/10 border-rose-500/40'
                )}>
                    {testResult.ok
                        ? <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
                        : <X size={16} className="text-rose-300 mt-0.5 shrink-0" />}
                    <div className={cn('text-xs whitespace-pre-line', testResult.ok ? 'text-emerald-100' : 'text-rose-200')}>
                        {testResult.message}
                    </div>
                </div>
            )}

            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40">
                <AlertTriangle size={14} className="text-amber-300 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-100/90 leading-relaxed">
                    Sending a test delivers one push message to your LINE destination, which counts against your LINE push-message quota.
                </p>
            </div>
        </div>
    );
}

// ---------- Modal ----------
const SubscriptionModal = ({
    open,
    onClose,
    currentTier = null,
    webPushSubscribed = false,
    channelStatus = {},
    onSubmit,
    onSendTest,
}) => {
    const [selected, setSelected] = useState('free');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    // After a successful smart/line connect we keep the modal open on a success
    // view that offers an optional, explicit test send (which spends LINE quota).
    const [connectedSubId, setConnectedSubId] = useState(null);
    const [confirmTestOpen, setConfirmTestOpen] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { ok, message }
    const [testCooldown, setTestCooldown] = useState(0); // seconds remaining

    // LINE credentials
    const [lineToken, setLineToken] = useState('');
    const [lineChatId, setLineChatId] = useState('');
    const [tokenVisible, setTokenVisible] = useState(false);
    const [chatVisible, setChatVisible] = useState(false);
    const [tokenCopied, setTokenCopied] = useState(false);
    const [chatCopied, setChatCopied] = useState(false);
    // Smart EE credentials — Group ID identifies the workspace, Pin ID is a
    // secret pairing code (masked here, encrypted at rest by the backend).
    const [smartGroupId, setSmartGroupId] = useState('');
    const [smartPinId, setSmartPinId] = useState('');
    const [groupVisible, setGroupVisible] = useState(false);
    const [pinVisible, setPinVisible] = useState(false);
    const [groupCopied, setGroupCopied] = useState(false);
    const [pinCopied, setPinCopied] = useState(false);
    // Submission error (e.g. invalid token, bot not in group, LINE API down)
    const [submitError, setSubmitError] = useState(null);
    // On success the backend returns bot/chat identity — we flash it briefly.
    const [submitSummary, setSubmitSummary] = useState(null);

    // Reset state on open
    useEffect(() => {
        if (open) {
            setSubmitting(false);
            setDone(false);
            setSelected('free');
            setSubmitError(null);
            setSubmitSummary(null);
            setConnectedSubId(null);
            setConfirmTestOpen(false);
            setTesting(false);
            setTestResult(null);
            setTestCooldown(0);
        } else {
            // Security: auto-hide secrets when modal closes
            setTokenVisible(false);
            setChatVisible(false);
            setGroupVisible(false);
            setPinVisible(false);
        }
    }, [open, currentTier]);

    // ESC to close
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        // Lock body scroll
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    const selectedTier = useMemo(() => TIERS.find(t => t.id === selected), [selected]);

    // Per-channel connection status for the selected tier.
    const selectedStatus = channelStatus?.[selected] || {};
    const isConnected = !!selectedStatus.subscribed;
    // smart/line lock into a read-only summary once connected — they can't be
    // re-connected or disconnected from here.
    const isLocked = (selected === 'smart' || selected === 'line') && isConnected;
    // Right after a successful connect we show a success view with an optional
    // test send — it takes priority over both the form and the locked summary.
    const justConnected = done && !!connectedSubId && (selected === 'smart' || selected === 'line');

    // Switching tiers clears any in-flight error/summary/test state from the
    // previous tier so nothing bleeds across channels.
    useEffect(() => {
        setSubmitError(null);
        setSubmitSummary(null);
        setConfirmTestOpen(false);
        setTestResult(null);
        setTestCooldown(0);
    }, [selected]);

    const submitDisabled = useMemo(() => {
        if (submitting || done) return true;
        if (isLocked) return true;
        if (selectedTier?.disabled) return true;
        if (selected === 'line' && (!lineToken.trim() || !lineChatId.trim())) return true;
        if (selected === 'smart' && (!smartGroupId.trim() || !smartPinId.trim())) return true;
        return false;
    }, [submitting, done, isLocked, selected, selectedTier, lineToken, lineChatId, smartGroupId, smartPinId]);

    // Tick down the post-send cooldown (mirrors the server-side throttle).
    useEffect(() => {
        if (testCooldown <= 0) return;
        const t = setTimeout(() => setTestCooldown((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [testCooldown]);

    const handleCopy = async (val, setCopied) => {
        try {
            await navigator.clipboard.writeText(val);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
    };

    // Send the confirmed test notification. Starts a cooldown afterwards
    // (success or failure) so the quota can't be drained by rapid retries.
    const handleConfirmTest = async () => {
        setConfirmTestOpen(false);
        // Works both right after connecting (connectedSubId) and from the locked
        // summary of an already-connected channel (selectedStatus.subscriptionId).
        const subId = connectedSubId || selectedStatus.subscriptionId;
        if (!subId || testing) return;
        setTesting(true);
        setTestResult(null);
        try {
            await onSendTest?.(subId);
            setTestResult({ ok: true, message: 'Test sent — check your LINE chat to confirm it arrived.' });
            setTestCooldown(5);
        } catch (err) {
            setTestResult({ ok: false, message: err?.message || 'Failed to send the test notification.' });
            // Honor a server-provided retry window if the cooldown tripped.
            setTestCooldown(Number.isFinite(err?.retryAfter) ? err.retryAfter : 5);
        } finally {
            setTesting(false);
        }
    };

    const handleSubmit = async () => {
        if (submitDisabled) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const payload =
                selected === 'line'
                    ? { tier: 'line', token: lineToken.trim(), chatId: lineChatId.trim() }
                    : selected === 'smart'
                        ? { tier: 'smart', groupId: smartGroupId.trim(), pinId: smartPinId.trim() }
                        : selected === 'free'
                            ? { tier: 'free', action: webPushSubscribed ? 'unsubscribe' : 'subscribe' }
                            : { tier: selected };
            const result = await onSubmit?.(payload);
            // Backend returns { line: { bot, chat } } or { smart: { groupId } }
            // on success — show it briefly.
            const summary = result?.line || result?.smart;
            if (summary) setSubmitSummary(summary);
            setDone(true);
            // For smart/line we stay open on a success view that offers an
            // optional test send (it spends quota, so it's never automatic).
            const testable = (selected === 'line' || selected === 'smart') && result?.subscriptionId;
            if (testable) {
                setConnectedSubId(result.subscriptionId);
            } else {
                // Free tier (or no id): close shortly after, as before.
                setTimeout(() => { onClose?.(); }, summary ? 1800 : 1100);
            }
        } catch (err) {
            console.error('Subscription submit failed:', err);
            setSubmitError(err?.message || 'Connection failed. Please try again.');
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-modal-title"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm animate-[scale-in_0.2s_ease-out]"
            />

            {/* Shell */}
            <div
                className={cn(
                    'relative w-full max-w-6xl max-h-[92vh] flex flex-col',
                    'bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden',
                    'shadow-[var(--shadow-elevated)]',
                    'animate-scale-in'
                )}
            >
                {/* Header */}
                <div
                    className="relative px-6 sm:px-8 py-6 border-b border-slate-700/80 shrink-0"
                    style={{ backgroundImage: 'var(--gradient-hero)' }}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wider uppercase bg-slate-900/60 border border-slate-700 text-slate-200">
                                <Crown size={12} className="text-amber-400" /> Notification Plans
                            </span>
                            <h2
                                id="subscription-modal-title"
                                className="mt-3 text-xl sm:text-2xl font-bold text-white tracking-tight"
                            >
                                Choose how you want to be notified
                            </h2>
                            <p className="mt-1.5 text-sm text-slate-300 max-w-2xl">
                                Pick the tier that fits your team. Upgrade or downgrade anytime — your existing subscriptions move with you.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close dialog"
                            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-slate-300 bg-slate-900/60 border border-slate-700 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6">
                    {/* Tier cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {TIERS.map((t) => {
                            const isSelected = selected === t.id;
                            const isCurrent = !!channelStatus?.[t.id]?.subscribed || currentTier === t.id;
                            const TIcon = t.Icon;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setSelected(t.id)}
                                    aria-pressed={isSelected}
                                    className={cn(
                                        'group relative text-left p-5 rounded-xl border transition-all duration-200 cursor-pointer',
                                        'bg-slate-800/60 backdrop-blur-sm',
                                        'hover:-translate-y-0.5 hover:border-slate-500',
                                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                                        isSelected
                                            ? cn('border ring-2', t.ringSelected, 'shadow-[var(--shadow-tier)]')
                                            : 'border-slate-700'
                                    )}
                                >
                                    {/* Badge */}
                                    {t.badge && (
                                        <span className={cn(
                                            'absolute -top-2.5 left-5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase',
                                            'bg-gradient-to-r text-white shadow-md',
                                            t.accent
                                        )}>
                                            {t.badge}
                                        </span>
                                    )}
                                    {isCurrent && (
                                        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                                            <CheckCircle2 size={10} /> Connected
                                        </span>
                                    )}
                                    {/* {t.disabled && !isCurrent && (
                                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 border border-amber-500/40 text-amber-300">
                                            Coming soon
                                        </span>
                                    )} */}

                                    {/* Icon tile */}
                                    <div className={cn(
                                        'w-11 h-11 rounded-xl flex items-center justify-center mb-4',
                                        'bg-gradient-to-br shadow-lg',
                                        t.accent
                                    )}>
                                        <TIcon size={20} className="text-white" />
                                    </div>

                                    <h3 className="text-base font-semibold text-white">{t.name}</h3>
                                    <p className="mt-0.5 text-xs text-slate-400">{t.price}</p>

                                    <ul className="mt-4 space-y-1.5">
                                        {t.features.map((f) => (
                                            <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
                                                <Check size={13} className="mt-0.5 text-emerald-400 shrink-0" />
                                                <span>{f}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <div className={cn(
                                        'mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs',
                                        isSelected ? 'text-blue-300' : 'text-slate-400'
                                    )}>
                                        <span>{isSelected ? 'Selected' : 'Click to select'}</span>
                                        <ArrowRight
                                            size={14}
                                            className={cn(
                                                'transition-transform',
                                                isSelected ? 'translate-x-0.5' : 'group-hover:translate-x-0.5'
                                            )}
                                        />
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Config panel — min-height prevents layout shift */}
                    <div className="min-h-[260px]">
                        {justConnected && (
                            <ConnectSuccessTest
                                channel={selected}
                                summary={submitSummary}
                                testResult={testResult}
                            />
                        )}

                        {selected === 'free' && (
                            <div className="space-y-4">
                                {webPushSubscribed ? (
                                    <div className="flex items-start gap-3 p-5 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
                                        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                                            <CheckCircle2 size={18} className="text-emerald-300" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Web Push is active on this device</h4>
                                            <p className="mt-1 text-sm text-slate-300">
                                                This browser is receiving real-time notifications. Disabling will stop delivery here only — your other devices are unaffected.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-3 p-5 rounded-xl bg-blue-500/5 border border-blue-500/30">
                                        <div className="w-9 h-9 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                                            <Bell size={18} className="text-blue-300" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Web Push is ready instantly</h4>
                                            <p className="mt-1 text-sm text-slate-300">
                                                Your browser will ask for permission. Once enabled, this device will receive notifications across all your authorized menus.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Submission error (permission blocked, unsupported browser, etc.) */}
                                {submitError && (
                                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/40">
                                        <X size={14} className="text-rose-300 mt-0.5 shrink-0" />
                                        <div className="text-xs text-rose-200 whitespace-pre-line">
                                            {submitError}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selected === 'smart' && !justConnected && isLocked && (
                            <ConnectedSummary
                                title="Smart EE Notification"
                                rows={[{ label: 'Group ID', value: selectedStatus.info?.groupId }]}
                                verifiedAt={selectedStatus.info?.verifiedAt}
                                notice="Changing the connected LINE room or group may incur additional charges. Please contact our support team to make this change."
                                testResult={testResult}
                            />
                        )}

                        {selected === 'smart' && !justConnected && !isLocked && (
                            <div className="space-y-4">
                                <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/30">
                                    <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
                                        <Sparkles size={18} className="text-violet-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-white">Smart EE Credentials</h4>
                                        <p className="mt-1 text-sm text-slate-300">
                                            Connect your Smart EE workspace by entering its Group ID and the Pin ID issued for this device. Your Pin is encrypted at rest and never exposed in logs.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <SecretField
                                            id="smart-groupid"
                                            label="Group ID"
                                            hint="Your Smart EE workspace / group identifier"
                                            value={smartGroupId}
                                            onChange={setSmartGroupId}
                                            visible={groupVisible}
                                            onToggle={() => setGroupVisible(v => !v)}
                                            onCopy={() => handleCopy(smartGroupId, setGroupCopied)}
                                            copied={groupCopied}
                                            placeholder="e.g. 162"
                                        />
                                    </div>
                                    <div>
                                        <SecretField
                                            id="smart-pinid"
                                            label="Pin ID"
                                            hint="The pairing PIN issued for this workspace — treat it like a password"
                                            value={smartPinId}
                                            onChange={setSmartPinId}
                                            visible={pinVisible}
                                            onToggle={() => setPinVisible(v => !v)}
                                            onCopy={() => handleCopy(smartPinId, setPinCopied)}
                                            copied={pinCopied}
                                            placeholder="Enter the device Pin ID"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                    <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-slate-400">
                                        Your Pin is masked by default and encrypted before it is stored. Toggle visibility only when verifying — your inputs auto-hide when you leave this dialog.
                                    </p>
                                </div>

                                {/* Submission error (invalid group/pin, Smart EE unreachable, etc.) */}
                                {submitError && (
                                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/40">
                                        <X size={14} className="text-rose-300 mt-0.5 shrink-0" />
                                        <div className="text-xs text-rose-200 whitespace-pre-line">
                                            {submitError}
                                        </div>
                                    </div>
                                )}

                                {/* Success summary — backend confirmed the workspace */}
                                {submitSummary?.groupId && (
                                    <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
                                        <CheckCircle2 size={18} className="text-emerald-300 shrink-0" />
                                        <div className="leading-tight">
                                            <div className="text-sm font-semibold text-white">Smart EE Notification</div>
                                            <div className="text-xs text-emerald-200/90">Connected successfully</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selected === 'line' && !justConnected && isLocked && (
                            <ConnectedSummary
                                title="LINE Bot Notification"
                                rows={[
                                    { label: 'Bot', value: selectedStatus.info?.bot?.displayName || selectedStatus.info?.bot?.basicId },
                                    {
                                        label: selectedStatus.info?.chatType === 'group' ? 'Group'
                                            : selectedStatus.info?.chatType === 'room' ? 'Room' : 'Chat',
                                        value: selectedStatus.info?.chat?.displayName || selectedStatus.info?.chatId,
                                    },
                                ]}
                                verifiedAt={selectedStatus.info?.verifiedAt}
                                notice="Changing the connected LINE room or group may incur additional charges. Please contact our support team to make this change."
                                testResult={testResult}
                            />
                        )}

                        {selected === 'line' && !justConnected && !isLocked && (
                            <div className="space-y-4">
                                <div className="flex items-start gap-3 p-4 rounded-xl bg-green-500/5 border border-green-500/30">
                                    <div className="w-9 h-9 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center shrink-0">
                                        <Shield size={18} className="text-green-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-white">LINE Bot Credentials</h4>
                                        <p className="mt-1 text-sm text-slate-300">
                                            Required to deliver messages to your LINE room or group. Credentials are encrypted at rest and never exposed in logs.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <SecretField
                                            id="line-token"
                                            label="Channel Access Token"
                                            hint="Find this in LINE Developers Console → Messaging API → Channel access token"
                                            value={lineToken}
                                            onChange={setLineToken}
                                            visible={tokenVisible}
                                            onToggle={() => setTokenVisible(v => !v)}
                                            onCopy={() => handleCopy(lineToken, setTokenCopied)}
                                            copied={tokenCopied}
                                            placeholder="Paste long-lived channel access token"
                                        />
                                        <div className="mt-2">
                                            <LineCredentialsGuide type="token" />
                                        </div>
                                    </div>
                                    <div>
                                        <SecretField
                                            id="line-chatid"
                                            label="Chat / Group / Room ID"
                                            hint="The destination ID where notifications will be sent (User ID, Group ID, or Room ID)"
                                            value={lineChatId}
                                            onChange={setLineChatId}
                                            visible={chatVisible}
                                            onToggle={() => setChatVisible(v => !v)}
                                            onCopy={() => handleCopy(lineChatId, setChatCopied)}
                                            copied={chatCopied}
                                            placeholder="e.g. U1234abcd… or C1234abcd…"
                                        />
                                        <div className="mt-2">
                                            <LineCredentialsGuide type="group" />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                    <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-slate-400">
                                        We mask sensitive values by default. Toggle visibility only when verifying — for security, your inputs auto-hide when you leave this dialog.
                                    </p>
                                </div>

                                {/* Submission error (token invalid, bot not in group, etc.) */}
                                {submitError && (
                                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/40">
                                        <X size={14} className="text-rose-300 mt-0.5 shrink-0" />
                                        <div className="text-xs text-rose-200 whitespace-pre-line">
                                            {submitError}
                                        </div>
                                    </div>
                                )}

                                {/* Success summary — backend confirmed bot + group reachable */}
                                {submitSummary && (
                                    <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
                                        <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
                                        <div className="text-xs text-emerald-100 space-y-0.5">
                                            <div>Connected — a test message has been sent to LINE</div>
                                            <div className="text-emerald-200/80">
                                                Bot: <span className="font-medium text-white">{submitSummary.bot?.displayName || submitSummary.bot?.basicId || 'Unknown'}</span>
                                                <span className="mx-1">→</span>
                                                {submitSummary.chat?.type === 'group' ? 'Group' : submitSummary.chat?.type === 'room' ? 'Room' : 'User'}: <span className="font-medium text-white">{submitSummary.chat?.displayName || '—'}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 px-6 sm:px-8 py-4 border-t border-slate-700 bg-slate-900/80 backdrop-blur-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <p className="text-xs text-slate-400 max-w-md">
                        By continuing you agree to our notification delivery policy. You can change tiers anytime.
                    </p>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="h-10 px-4 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            Cancel
                        </button>

                        {/* Send test — only for a connected smart/line channel. Spends a
                            LINE push message, so it's confirmed + cooldown-throttled. */}
                        {onSendTest && (isLocked || justConnected) && (() => {
                            const cooling = testCooldown > 0;
                            return (
                                <button
                                    type="button"
                                    onClick={() => setConfirmTestOpen(true)}
                                    disabled={testing || cooling}
                                    className={cn(
                                        'h-10 px-4 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2 cursor-pointer',
                                        'bg-gradient-to-r from-amber-400 via-orange-500 to-orange-600 shadow-lg shadow-orange-900/30',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                                        'hover:-translate-y-px active:translate-y-0 transition-all duration-150',
                                        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0'
                                    )}
                                >
                                    {testing
                                        ? <><Loader2 size={16} className="animate-spin" /> Sending…</>
                                        : cooling
                                            ? <>Wait {testCooldown}s</>
                                            : <><Bell size={16} /> Send test notification</>}
                                </button>
                            );
                        })()}

                        {!justConnected && !isLocked && (() => {
                            const isFreeUnsub = selected === 'free' && webPushSubscribed;
                            const accent = isFreeUnsub
                                ? 'from-red-500 to-rose-500'
                                : (selectedTier?.accent || 'from-blue-500 to-emerald-500');
                            return (
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={submitDisabled}
                                    className={cn(
                                        'h-10 px-5 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2 cursor-pointer',
                                        'bg-gradient-to-r shadow-lg transition-all duration-150',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                                        isFreeUnsub ? 'focus-visible:ring-red-400' : 'focus-visible:ring-blue-400',
                                        'hover:-translate-y-px active:translate-y-0',
                                        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
                                        accent
                                    )}
                                >
                                    {done ? (
                                        <>
                                            <CheckCircle2 size={16} />
                                            {isFreeUnsub ? 'Disabled' : 'Activated'}
                                        </>
                                    ) : submitting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            {isFreeUnsub ? 'Disabling…' : 'Activating…'}
                                        </>
                                    ) : isLocked ? (
                                        <>
                                            <CheckCircle2 size={16} />
                                            Connected
                                        </>
                                    ) : selectedTier?.disabled ? (
                                        <>Coming soon</>
                                    ) : isFreeUnsub ? (
                                        <>
                                            <BellOff size={16} />
                                            Disable Web Push
                                        </>
                                    ) : (
                                        <>
                                            {selectedTier?.cta || 'Continue'}
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* Nested confirm before spending a LINE push message on a test. */}
            <ConfirmDialog
                open={confirmTestOpen}
                title="Send a test notification?"
                body="This delivers one push message to your LINE destination, which counts against your monthly LINE push-message quota. Only send a test when you want to confirm delivery."
                confirmLabel="Send test"
                onConfirm={handleConfirmTest}
                onCancel={() => setConfirmTestOpen(false)}
            />
        </div>
    );
};

export default SubscriptionModal;
