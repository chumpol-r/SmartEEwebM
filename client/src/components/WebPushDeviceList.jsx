import React, { useState } from 'react';
import { Loader2, Monitor, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// ---------- DeviceRow ----------
// One Web Push subscription. Deleting is destructive, so the trash button flips
// the row into an inline confirm ("Remove?") rather than firing immediately or
// stacking a separate dialog.
function DeviceRow({ device, isThisDevice, confirming, removing, error, onAskRemove, onCancelRemove, onConfirmRemove }) {
    const added = formatDate(device.createdAt);
    return (
        <li className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700">
            <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border',
                isThisDevice ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-slate-700/60 border-slate-600 text-slate-300'
            )}>
                <Monitor size={16} />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                        {device.deviceLabel || 'Unknown device'}
                    </span>
                    {isThisDevice && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-500/15 border border-blue-500/40 text-blue-300 shrink-0">
                            This device
                        </span>
                    )}
                </div>
                <p className="text-xs text-slate-400 truncate">
                    {added ? `Added ${added}` : 'Active'}
                </p>
                {error && (
                    <p className="mt-1 text-xs text-rose-300">{error}</p>
                )}
            </div>

            {/* Inline confirm vs. trash trigger */}
            {confirming ? (
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={onCancelRemove}
                        disabled={removing}
                        className="h-8 px-2.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirmRemove}
                        disabled={removing}
                        className="h-8 px-3 rounded-md text-xs font-medium text-white inline-flex items-center gap-1.5 bg-gradient-to-r from-red-500 to-rose-500 shadow disabled:opacity-50 cursor-pointer"
                    >
                        {removing ? <><Loader2 size={13} className="animate-spin" /> Removing…</> : 'Remove'}
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onAskRemove}
                    aria-label={`Remove ${device.deviceLabel || 'device'}`}
                    title="Remove this device"
                    className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                    <Trash2 size={16} />
                </button>
            )}
        </li>
    );
}

// ---------- WebPushDeviceList ----------
// Self-contained Web Push device manager: lists every Web Push subscription on
// the account and removes them one at a time. Shared by both subscription modals
// (the header `SubscriptionModal` and `SubscriptionModalV2` in NotifyConfig) so
// the device UI has a single source of truth and can't drift between the two.
//
// Data + the remove action come from Layout's subscription engine via props
// (`devices` / `currentDeviceId` / `onRemoveDevice`); this component owns only
// the transient per-row confirm/removing/error state.
const WebPushDeviceList = ({ devices = [], currentDeviceId = null, onRemoveDevice }) => {
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);
    const [removingId, setRemovingId] = useState(null);
    const [removeError, setRemoveError] = useState(null); // { id, message }

    const handleConfirmRemove = async (subId) => {
        if (removingId) return;
        setRemovingId(subId);
        setRemoveError(null);
        try {
            await onRemoveDevice?.(subId);
            // Layout refreshes `devices`; the row simply disappears.
            setConfirmRemoveId(null);
        } catch (err) {
            setRemoveError({ id: subId, message: err?.message || 'Failed to remove this device.' });
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white">Your devices</h3>
                <span className="text-xs text-slate-400">{devices.length} active</span>
            </div>

            {devices.length === 0 ? (
                <div className="px-3 py-6 rounded-lg bg-slate-800/40 border border-dashed border-slate-700 text-center">
                    <Monitor size={20} className="mx-auto text-slate-500" />
                    <p className="mt-2 text-xs text-slate-400">
                        No devices yet. Enable Web Push to start receiving notifications.
                    </p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {devices.map((d) => (
                        <DeviceRow
                            key={d.subscriptionId}
                            device={d}
                            isThisDevice={!!currentDeviceId && d.deviceId === currentDeviceId}
                            confirming={confirmRemoveId === d.subscriptionId}
                            removing={removingId === d.subscriptionId}
                            error={removeError?.id === d.subscriptionId ? removeError.message : null}
                            onAskRemove={() => { setRemoveError(null); setConfirmRemoveId(d.subscriptionId); }}
                            onCancelRemove={() => setConfirmRemoveId(null)}
                            onConfirmRemove={() => handleConfirmRemove(d.subscriptionId)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};

export default WebPushDeviceList;
