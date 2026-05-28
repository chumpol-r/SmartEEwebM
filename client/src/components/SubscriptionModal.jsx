import React, { useEffect, useMemo, useState } from 'react';
import {
    X, Bell, BellOff, Sparkles, MessageCircle, Crown, Check, CheckCircle2,
    ArrowRight, Loader2, Shield, Eye, EyeOff, Copy, Info,
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
        badge: 'Most Popular',
        Icon: Sparkles,
        accent: 'from-violet-500 to-pink-500',
        ringSelected: 'ring-violet-500/30 border-violet-500',
        cta: 'Upgrade to Smart EE',
        disabled: true,
        disabledReason: 'Coming soon — not yet available',
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
        badge: 'Highest Tier',
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

const SMART_FEATURES = [
    { title: 'Anomaly Detection', desc: 'Automatic baselines per device, flagged in real time.' },
    { title: 'Custom Thresholds', desc: 'Per-metric rules with delay & severity levels.' },
    { title: 'Smart Digests',     desc: 'Hourly, daily, or weekly summaries to email or in-app.' },
    { title: 'Multi-Channel',     desc: 'Web push, email, webhook — choose per alert.' },
    { title: 'Team Routing',      desc: 'Route by role, shift, or on-call schedule.' },
    { title: 'Audit Log',         desc: 'Full delivery history with retries and acknowledgments.' },
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

// ---------- Modal ----------
const SubscriptionModal = ({ open, onClose, currentTier = null, webPushSubscribed = false, onSubmit }) => {
    const [selected, setSelected] = useState('free');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    // LINE credentials
    const [lineToken, setLineToken] = useState('');
    const [lineChatId, setLineChatId] = useState('');
    const [tokenVisible, setTokenVisible] = useState(false);
    const [chatVisible, setChatVisible] = useState(false);
    const [tokenCopied, setTokenCopied] = useState(false);
    const [chatCopied, setChatCopied] = useState(false);

    // Reset state on open
    useEffect(() => {
        if (open) {
            setSubmitting(false);
            setDone(false);
            setSelected('free');
        } else {
            // Security: auto-hide secrets when modal closes
            setTokenVisible(false);
            setChatVisible(false);
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

    const submitDisabled = useMemo(() => {
        if (submitting || done) return true;
        if (selectedTier?.disabled) return true;
        if (selected === 'line' && (!lineToken.trim() || !lineChatId.trim())) return true;
        return false;
    }, [submitting, done, selected, selectedTier, lineToken, lineChatId]);

    const handleCopy = async (val, setCopied) => {
        try {
            await navigator.clipboard.writeText(val);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
    };

    const handleSubmit = async () => {
        if (submitDisabled) return;
        setSubmitting(true);
        try {
            const payload =
                selected === 'line'
                    ? { tier: 'line', token: lineToken.trim(), chatId: lineChatId.trim() }
                    : selected === 'free'
                        ? { tier: 'free', action: webPushSubscribed ? 'unsubscribe' : 'subscribe' }
                        : { tier: selected };
            await onSubmit?.(payload);
            setDone(true);
            setTimeout(() => { onClose?.(); }, 1100);
        } catch (err) {
            console.error('Subscription submit failed:', err);
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
                            const isCurrent = currentTier === t.id;
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
                                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                                            Current
                                        </span>
                                    )}
                                    {t.disabled && !isCurrent && (
                                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 border border-amber-500/40 text-amber-300">
                                            Coming soon
                                        </span>
                                    )}

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
                        {selected === 'free' && (
                            webPushSubscribed ? (
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
                            )
                        )}

                        {selected === 'smart' && (
                            <div>
                                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/30 mb-4">
                                    <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                                        <Info size={18} className="text-amber-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-white">Coming soon</h4>
                                        <p className="mt-1 text-sm text-slate-300">
                                            Smart EE Notification is not yet available. You can preview the included capabilities below — activation will open once the service is released.
                                        </p>
                                    </div>
                                </div>
                                <h4 className="text-sm font-semibold text-white mb-3">What's included</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {SMART_FEATURES.map((f) => (
                                        <div
                                            key={f.title}
                                            className="flex items-start gap-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-violet-500/50 transition-colors"
                                        >
                                            <CheckCircle2 size={18} className="text-violet-400 mt-0.5 shrink-0" />
                                            <div>
                                                <div className="text-sm font-medium text-white">{f.title}</div>
                                                <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selected === 'line' && (
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
                        {(() => {
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
        </div>
    );
};

export default SubscriptionModal;
