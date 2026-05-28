import React from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

const TIER_META = {
    free:  { label: 'Web Push',  dot: 'bg-blue-500   ring-blue-400/40' },
    smart: { label: 'Smart EE',  dot: 'bg-violet-500 ring-violet-400/40' },
    line:  { label: 'LINE Bot',  dot: 'bg-green-500  ring-green-400/40' },
};

const SubscribeButton = React.forwardRef(function SubscribeButton(
    { onClick, currentTier = null, busy = false, hasUnread = false, open = false, className },
    ref
) {
    const tier = currentTier && TIER_META[currentTier] ? TIER_META[currentTier] : null;
    const label = tier ? tier.label : 'Subscribe';
    const dotClass = tier ? tier.dot : 'bg-slate-500 ring-slate-400/30';

    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-label="Manage notification subscription"
            aria-haspopup="dialog"
            aria-expanded={open}
            title={tier
                ? `${tier.label} active · Click to manage subscription`
                : 'Not subscribed · Click to manage subscription'}
            className={cn(
                'group relative inline-flex items-center gap-2 h-10 rounded-full',
                'text-sm font-medium transition-all duration-150 ease-out cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                'hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed',
                // Compact icon-only on mobile
                'px-2 sm:px-4',
                tier
                    // Subscribed (filled subtle)
                    ? 'bg-blue-500/10 text-blue-300 border border-blue-500/40 hover:bg-blue-500/15'
                    // Idle (outline)
                    : 'bg-slate-800/70 text-slate-200 border border-slate-700 hover:border-slate-500 hover:text-white',
                className
            )}
        >
            <span className="relative inline-flex items-center justify-center w-5 h-5 shrink-0">
                {busy ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : (
                    <Bell size={16} className={tier ? 'text-blue-300' : 'text-slate-300'} />
                )}
                {/* Status dot */}
                <span
                    className={cn(
                        'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-slate-900',
                        dotClass
                    )}
                />
                {/* Unread pulse ring */}
                {hasUnread && !busy && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                )}
            </span>
            <span className="hidden sm:inline whitespace-nowrap">{label}</span>
        </button>
    );
});

export default SubscribeButton;
