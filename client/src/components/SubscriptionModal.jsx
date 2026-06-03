import React, { useEffect, useState } from 'react';
import { X, Bell, CheckCircle2, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import WebPushDeviceList from './WebPushDeviceList.jsx';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// ---------- SubscriptionModal (Web Push only) ----------
// Slimmed from the original 3-tier (Web Push / Smart EE / LINE) plan modal down
// to a single-purpose Web Push dialog with a device manager. The smart/line
// subscription engine still lives in Layout.jsx and is used by NotifyConfig's
// `SubscriptionModalV2` — this header modal just no longer surfaces those
// channels. The device list is the single source of truth for managing Web Push:
// each device (including this one) is removable from its row, so there is no
// separate disable button when this device is already subscribed.
const SubscriptionModal = ({
    open,
    onClose,
    webPushSubscribed = false,
    onSubmit,
    devices = [],
    currentDeviceId = null,
    onRemoveDevice,
}) => {
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    // Submission error (permission blocked, unsupported/in-app browser, etc.)
    const [submitError, setSubmitError] = useState(null);

    // Reset transient state on open
    useEffect(() => {
        if (open) {
            setSubmitting(false);
            setDone(false);
            setSubmitError(null);
        }
    }, [open]);

    // ESC to close + lock body scroll while open
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    const handleSubmit = async () => {
        if (submitting || done) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            // Enable on THIS device. Layout runs the full browser-side flow
            // (permission, SW, pushManager, POST) and refreshes the device list.
            await onSubmit?.({ tier: 'free', action: 'subscribe' });
            setDone(true);
            setTimeout(() => setDone(false), 1500);
        } catch (err) {
            console.error('Web Push subscribe failed:', err);
            setSubmitError(err?.message || 'Connection failed. Please try again.');
        } finally {
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
                    'relative w-full max-w-md max-h-[92vh] flex flex-col',
                    'bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden',
                    'shadow-[var(--shadow-elevated)] animate-scale-in'
                )}
            >
                {/* Header */}
                <div
                    className="relative px-6 py-5 border-b border-slate-700/80 shrink-0"
                    style={{ backgroundImage: 'var(--gradient-hero)' }}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg flex items-center justify-center shrink-0">
                                <Bell size={20} className="text-white" />
                            </div>
                            <div>
                                <h2
                                    id="subscription-modal-title"
                                    className="text-lg font-bold text-white tracking-tight"
                                >
                                    Web Push Notifications
                                </h2>
                                <p className="text-xs text-slate-300 mt-0.5">
                                    Real-time browser alerts on your devices
                                </p>
                            </div>
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
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Status card for THIS device */}
                    {webPushSubscribed ? (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
                            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                                <CheckCircle2 size={18} className="text-emerald-300" />
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-white">Web Push is active on this device</h4>
                                <p className="mt-1 text-sm text-slate-300">
                                    This browser is receiving real-time notifications. Remove it below to stop delivery here — your other devices are unaffected.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/30">
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

                    {/* Device list — every Web Push subscription on this account */}
                    <WebPushDeviceList
                        devices={devices}
                        currentDeviceId={currentDeviceId}
                        onRemoveDevice={onRemoveDevice}
                    />
                </div>

                {/* Footer */}
                <div className="shrink-0 px-6 py-4 border-t border-slate-700 bg-slate-900/80 backdrop-blur-sm flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="h-10 px-4 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        Close
                    </button>

                    {/* Enable is only offered when THIS device isn't subscribed —
                        removal of any device (including this one) is done from its
                        row, so there's never a duplicate disable affordance. */}
                    {!webPushSubscribed && (
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting || done}
                            className={cn(
                                'h-10 px-5 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2 cursor-pointer',
                                'bg-gradient-to-r from-blue-500 to-cyan-500 shadow-lg transition-all duration-150',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                                'hover:-translate-y-px active:translate-y-0',
                                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0'
                            )}
                        >
                            {done ? (
                                <><CheckCircle2 size={16} /> Activated</>
                            ) : submitting ? (
                                <><Loader2 size={16} className="animate-spin" /> Activating…</>
                            ) : (
                                <><Bell size={16} /> Enable Web Push</>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SubscriptionModal;
