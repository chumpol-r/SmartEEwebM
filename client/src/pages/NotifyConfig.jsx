import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Search, Edit2, Trash2, X, Save, RefreshCw, Bell, BellRing, Loader2, Plus } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useSubscription } from '../contexts/SubscriptionContext.jsx';
import SubscriptionModalV2 from '../components/SubscriptionModalV2.jsx';

// ALARM_TYPES dropdown removed from this modal — value is preserved in payload
// and edited via SetNotifyModal. Backend has its own NC_VALID_ALARM_TYPES whitelist.
const REFRESH_INTERVAL_MS = 5000;

// Display order (top → bottom). Lower index = higher in the table.
const LEVEL_ORDER = ['Very High', 'High', 'Normal', 'Low', 'Very Low'];
const levelRank = (lvl) => {
    const i = LEVEL_ORDER.indexOf(lvl);
    return i === -1 ? 99 : i;
};

// Suggested alert text by level — applied as input placeholder for empty messages.
// User can override; this is guidance only and never auto-saved.
const MESSAGE_PLACEHOLDER = {
    'Very High': 'Very High Alert',
    'High':      'High Alert',
    'Normal':    'Normal Alert',
    'Low':       'Low Alert',
    'Very Low':  'Very Low Alert',
};

// Client-only marker for rows added in the modal that don't yet have a DB id.
// Saved via POST /api/notify (upsert); after save+refetch they get real notifyIds.
const isTempId = (id) => typeof id === 'string' && id.startsWith('temp-');

// Model B monotonic constraint: point thresholds must satisfy
//   Very Low ≤ Low      (lower-bound pair)
//   High    ≤ Very High (upper-bound pair)
// Normal is a baseline (typically 0), not part of the chain.
// Returns array of { message, notifyIds[] } — empty when group passes.
function validateMonotonic(rows) {
    const errors = [];
    const byLevel = {};
    rows.forEach(r => { byLevel[r.level] = r; });

    const num = (r) => {
        if (!r) return null;
        const v = Number(r.point);
        return Number.isFinite(v) ? v : null;
    };

    const h = byLevel['High'], vh = byLevel['Very High'];
    const hV = num(h), vhV = num(vh);
    if (h && vh && hV !== null && vhV !== null && hV > vhV) {
        errors.push({
            message: `High (${hV}) ต้อง ≤ Very High (${vhV})`,
            notifyIds: [h.notifyId, vh.notifyId],
        });
    }

    const l = byLevel['Low'], vl = byLevel['Very Low'];
    const lV = num(l), vlV = num(vl);
    if (l && vl && lV !== null && vlV !== null && vlV > lV) {
        errors.push({
            message: `Very Low (${vlV}) ต้อง ≤ Low (${lV})`,
            notifyIds: [vl.notifyId, l.notifyId],
        });
    }

    return errors;
}

const NotifyConfig = () => {
    const toast = useToast();
    // Subscription engine (status + handlers) shared from Layout via context.
    // Lets this page open its own modal variant without re-wiring Web Push/LINE/Smart EE.
    const subscription = useSubscription();
    const [subModalOpen, setSubModalOpen] = useState(false);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Edit modal state
    const [editingGroup, setEditingGroup] = useState(null); // { serialId, serialName }
    const [editRows, setEditRows] = useState([]);            // editable copy of the group's rows
    const [saving, setSaving] = useState(false);

    // Track modal-open with a ref so the polling interval (registered once) always
    // sees the latest value without re-subscribing. Kept in sync via useEffect to
    // avoid mutating during render (StrictMode-safe).
    const modalOpenRef = useRef(false);
    useEffect(() => { modalOpenRef.current = editingGroup !== null; }, [editingGroup]);

    // Per-modal counter for client-side temp ids on newly added rows.
    const tempIdCounter = useRef(0);

    // Per-dbKey state for the "Add level" picker (which missing level is selected).
    // Map of dbKey → selected level string. Resets when modal closes.
    const [addPickerLevel, setAddPickerLevel] = useState({});

    // 200ms debounce on search so the spinner has meaning and we filter once per pause
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm), 200);
        return () => clearTimeout(t);
    }, [searchTerm]);
    const isSearching = searchTerm !== debouncedSearch;

    const fetchAll = useCallback(async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const res = await axios.get('/api/notify/all');
            if (res.data?.success) setRows(res.data.data || []);
        } catch (err) {
            console.error('Error fetching notify configs:', err);
        } finally {
            if (showSpinner) setLoading(false);
        }
    }, []);

    // Initial load + lightweight polling so the grid stays fresh (paused while editing)
    useEffect(() => {
        fetchAll(true);
        const id = setInterval(() => {
            if (!modalOpenRef.current) fetchAll(false);
        }, REFRESH_INTERVAL_MS);
        return () => clearInterval(id);
    }, [fetchAll]);

    // Group rows by serial_id, sorted ascending so polling refresh doesn't shuffle the table
    const groupsMap = rows.reduce((acc, row) => {
        const key = row.serialId;
        if (!acc[key]) {
            acc[key] = { serialId: row.serialId, serialName: row.serialName, rows: [] };
        }
        acc[key].rows.push(row);
        return acc;
    }, {});
    const groups = Object.values(groupsMap).sort((a, b) =>
        String(a.serialId).localeCompare(String(b.serialId), undefined, { numeric: true })
    );

    const search = debouncedSearch.trim().toLowerCase();
    const filteredGroups = search
        ? groups.filter(g =>
            String(g.serialId).toLowerCase().includes(search) ||
            (g.serialName || '').toLowerCase().includes(search) ||
            g.rows.some(r =>
                (r.dbKey || '').toLowerCase().includes(search) ||
                (r.level || '').toLowerCase().includes(search)
            )
        )
        : groups;

    const openEdit = (group) => {
        setEditingGroup({ serialId: group.serialId, serialName: group.serialName });
        setEditRows(group.rows.map(r => ({ ...r })));
        setAddPickerLevel({});
        tempIdCounter.current = 0;
    };

    const closeEdit = () => {
        setEditingGroup(null);
        setEditRows([]);
        setAddPickerLevel({});
    };

    const handleFieldChange = (notifyId, field, value) => {
        setEditRows(prev => prev.map(r =>
            r.notifyId === notifyId ? { ...r, [field]: value } : r
        ));
    };

    // Insert a new temp row for a missing level inside an existing dbKey box.
    // Defaults per spec: point='0.00', delay='10', message='' (placeholder shown),
    // alarmType='' (user must pick). Re-render places it at the correct sort slot.
    const handleAddRow = (dbKey, level) => {
        if (!editingGroup || !level) return;
        const tempId = `temp-${++tempIdCounter.current}`;
        setEditRows(prev => [...prev, {
            notifyId: tempId,
            serialId: editingGroup.serialId,
            serialName: editingGroup.serialName,
            dbKey,
            level,
            point: '0.00',
            delay: '10',
            message: '',
            alarmType: '',
            isNew: true,
        }]);
        // Clear this dbKey's picker so the next missing level auto-populates the dropdown
        setAddPickerLevel(prev => {
            const next = { ...prev };
            delete next[dbKey];
            return next;
        });
    };

    const handleDeleteRow = async (notifyId) => {
        // Temp rows (not yet saved) just disappear — no confirm, no API call.
        if (isTempId(notifyId)) {
            setEditRows(prev => prev.filter(r => r.notifyId !== notifyId));
            return;
        }

        const confirmed = await toast.confirm('ต้องการลบ config แถวนี้หรือไม่?', {
            title: 'Delete Notify Config',
            type: 'error',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        try {
            await axios.delete(`/api/notify/${notifyId}`);
            setEditRows(prev => prev.filter(r => r.notifyId !== notifyId));
            setRows(prev => prev.filter(r => r.notifyId !== notifyId));
            toast.success('ลบสำเร็จ');
        } catch (err) {
            console.error('Error deleting notify config:', err);
            toast.error('ลบไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
        }
    };

    // Group the editing rows by dbkey, levels sorted Very High → Very Low within each box.
    // Also compute `missingLevels` so the UI can show an "Add level" picker only when needed.
    const dbKeyGroups = Object.values(
        editRows.reduce((acc, r) => {
            if (!acc[r.dbKey]) acc[r.dbKey] = { dbKey: r.dbKey, rows: [] };
            acc[r.dbKey].rows.push(r);
            return acc;
        }, {})
    ).map(g => {
        const presentLevels = new Set(g.rows.map(r => r.level));
        const sortedRows = [...g.rows].sort((a, b) => levelRank(a.level) - levelRank(b.level));
        const errors = validateMonotonic(sortedRows);
        const errorIds = new Set(errors.flatMap(e => e.notifyIds));
        return {
            ...g,
            rows: sortedRows,
            missingLevels: LEVEL_ORDER.filter(L => !presentLevels.has(L)),
            errors,
            errorIds,
        };
    });

    // Total monotonic errors across all dbKey groups — used to block Save
    const totalErrors = dbKeyGroups.reduce((acc, g) => acc + g.errors.length, 0);

    const handleSave = async () => {
        if (saving) return;

        // Belt-and-braces: Save button is disabled when totalErrors > 0, but if
        // the user somehow triggers save, refuse with a clear message.
        if (totalErrors > 0) {
            toast.error(`มีค่า point ที่ไม่ถูกต้อง ${totalErrors} จุด กรุณาแก้ไขก่อนบันทึก`);
            return;
        }

        // Validate: non-Normal rows must have point AND delay filled. Empty strings
        // would silently coerce to 0 via Number('') and could trigger false alarms.
        const invalid = editRows.find(r => {
            if (r.level === 'Normal') return false;
            const pointEmpty = r.point === '' || r.point === null || r.point === undefined;
            const delayEmpty = r.delay === '' || r.delay === null || r.delay === undefined;
            return pointEmpty || delayEmpty;
        });
        if (invalid) {
            toast.error(`กรุณากรอก point และ delay ของ ${invalid.dbKey} (${invalid.level}) ให้ครบ`);
            return;
        }

        // Split temp (new) vs existing rows — both sent in one atomic call.
        const creates = editRows.filter(r => isTempId(r.notifyId));
        const updates = editRows.filter(r => !isTempId(r.notifyId));

        setSaving(true);
        try {
            // Single atomic call — server wraps creates + updates in a DB transaction.
            // Any failure rolls back BOTH sets, so we never end up in a half-saved state.
            // Field-name mapping must match the backend contract: `serial`, `levelName`,
            // `originalId` (not serialName/level/serialId).
            const payload = {
                updates: updates.map(r => ({
                    notifyId: r.notifyId,
                    // updatedAt = original timestamp from the GET; backend rejects the
                    // write if the DB row has changed since (optimistic locking).
                    updatedAt: r.updatedAt,
                    point: Number(r.point) || 0,
                    delay: Number(r.delay) || 0,
                    message: r.message || '',
                    alarmType: r.alarmType || ''
                })),
                creates: creates.map(r => ({
                    serial: r.serialName,
                    dbKey: r.dbKey,
                    levelName: r.level,
                    point: Number(r.point) || 0,
                    delay: Number(r.delay) || 0,
                    message: r.message || '',
                    alarmType: r.alarmType || '',
                    originalId: r.serialId,
                })),
            };
            await axios.post('/api/notify/save', payload);

            toast.success('บันทึกการแก้ไขสำเร็จ');
            closeEdit();
            fetchAll(false);
        } catch (err) {
            console.error('Error saving notify configs:', err);
            toast.error('บันทึกไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    // 100dvh - 7rem = Layout header (h-16 = 4rem) + Layout p-6 vertical padding (3rem). Adjust if Layout changes.
    return (
        <div className="h-[calc(100dvh-7rem)] flex flex-col gap-4 max-w-7xl mx-auto w-full">
            {/* Header */}
            <div className="flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Bell size={24} /> Notify Config
                    </h1>
                    <p className="text-slate-400">จัดการการแจ้งเตือนของแต่ละ Serial ({groups.length} serials)</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setSubModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 via-violet-600 to-pink-600 hover:opacity-90 text-white rounded-lg transition-opacity shadow-lg shadow-violet-900/30 cursor-pointer"
                    >
                        <BellRing size={18} />
                        <span>Notification Channels</span>
                    </button>
                    <button
                        onClick={() => fetchAll(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors cursor-pointer"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="flex gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700 shrink-0">
                <div className="relative flex-1">
                    {isSearching ? (
                        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" size={20} />
                    ) : (
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    )}
                    <input
                        type="text"
                        placeholder="Search by ..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Grid grouped by serial — grows to fill, scrolls internally with sticky thead */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left">
                        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
                            <tr className="border-b border-slate-700">
                                <th className="p-4 text-slate-400 font-medium">Serial</th>
                                <th className="p-4 text-slate-400 font-medium">Serial Name</th>
                                <th className="p-4 text-slate-400 font-medium">Configs</th>
                                <th className="p-4 text-slate-400 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="4" className="p-8 text-center text-slate-400">Loading...</td></tr>
                            ) : filteredGroups.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-slate-400">
                                        {search
                                            ? <>ไม่พบข้อมูลที่ตรงกับ &quot;{searchTerm}&quot;</>
                                            : 'ไม่มีข้อมูล'}
                                    </td>
                                </tr>
                            ) : (
                                filteredGroups.map(group => (
                                    <tr key={group.serialId} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                                        <td className="p-4 text-slate-300 font-mono">{group.serialId}</td>
                                        <td className="p-4 font-medium text-white">{group.serialName || '-'}</td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 rounded-full bg-slate-700 text-slate-300 text-sm border border-slate-600">
                                                {group.rows.length} รายการ
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => openEdit(group)}
                                                className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer — pinned at bottom of card */}
                <div className="shrink-0 px-4 py-3 border-t border-slate-700 text-sm text-slate-400 bg-slate-900/30">
                    แสดง <span className="text-white font-semibold">{filteredGroups.length}</span>
                    {search
                        ? <> รายการ (กรองแล้ว จาก {groups.length} ทั้งหมด)</>
                        : <> จาก <span className="text-white font-semibold">{groups.length}</span> serials</>}
                </div>
            </div>

            {/* Edit Group Modal */}
            {editingGroup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-5xl max-h-[90dvh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-700 shrink-0">
                            <h2 className="text-xl font-bold text-white">
                                Edit Notify — <span className="text-blue-400">{editingGroup.serialName}</span>
                                <span className="text-slate-500 text-sm font-normal"> (serial {editingGroup.serialId})</span>
                            </h2>
                            <button onClick={closeEdit} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {editRows.length === 0 ? (
                                <div className="p-6 text-center text-slate-400">ไม่มี config เหลืออยู่</div>
                            ) : (
                                dbKeyGroups.map(group => {
                                    const pickedLevel = addPickerLevel[group.dbKey] || group.missingLevels[0] || '';
                                    const hasErrors = group.errors.length > 0;
                                    return (
                                        <div key={group.dbKey} className={`border rounded-lg overflow-hidden ${hasErrors ? 'border-red-500/60' : 'border-slate-700'}`}>
                                            <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-700 font-semibold text-blue-400">
                                                {group.dbKey}
                                            </div>
                                            {/* Monotonic validation banner — only when this dbKey has constraint errors */}
                                            {hasErrors && (
                                                <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-300 text-xs space-y-0.5">
                                                    {group.errors.map((e, i) => (
                                                        <div key={i}>⚠ {e.message}</div>
                                                    ))}
                                                </div>
                                            )}
                                            <table className="w-full text-left text-sm">
                                                <thead>
                                                    <tr className="bg-slate-900/40 border-b border-slate-700 text-slate-400">
                                                        <th className="p-2">level</th>
                                                        <th className="p-2 w-28">point</th>
                                                        <th className="p-2 w-24">delay</th>
                                                        <th className="p-2">message</th>
                                                        <th className="p-2 w-40">channels</th>
                                                        <th className="p-2 w-12"></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {group.rows.map(r => {
                                                        const isNormal = r.level === 'Normal';
                                                        const rowBg = r.isNew ? 'bg-blue-500/5' : '';
                                                        const pointErr = group.errorIds.has(r.notifyId);
                                                        const pointBorder = pointErr ? 'border-red-500' : 'border-slate-600 focus:border-blue-500';
                                                        return (
                                                            <tr key={r.notifyId} className={`border-b border-slate-700 last:border-b-0 ${rowBg}`}>
                                                                <td className="p-2 text-slate-300">
                                                                    {r.level}
                                                                    {r.isNew && <span className="ml-2 text-xs text-blue-400">(new)</span>}
                                                                </td>
                                                                <td className="p-2">
                                                                    {isNormal ? (
                                                                        <span className="text-slate-500">-</span>
                                                                    ) : (
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={r.point}
                                                                            onChange={(e) => handleFieldChange(r.notifyId, 'point', e.target.value)}
                                                                            className={`w-full bg-slate-900 border rounded px-2 py-1 text-white focus:outline-none ${pointBorder}`}
                                                                        />
                                                                    )}
                                                                </td>
                                                                <td className="p-2">
                                                                    {isNormal ? (
                                                                        <span className="text-slate-500">-</span>
                                                                    ) : (
                                                                        <input
                                                                            type="number"
                                                                            value={r.delay}
                                                                            onChange={(e) => handleFieldChange(r.notifyId, 'delay', e.target.value)}
                                                                            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                                                        />
                                                                    )}
                                                                </td>
                                                                <td className="p-2">
                                                                    <input
                                                                        type="text"
                                                                        value={r.message}
                                                                        placeholder={MESSAGE_PLACEHOLDER[r.level] || ''}
                                                                        onChange={(e) => handleFieldChange(r.notifyId, 'message', e.target.value)}
                                                                        className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <div className="flex items-center gap-3">
                                                                        {['device', 'line'].map(ch => {
                                                                            const set = new Set(
                                                                                String(r.alarmType || '')
                                                                                    .toLowerCase()
                                                                                    .split(',')
                                                                                    .map(s => s.trim())
                                                                                    .filter(Boolean)
                                                                            );
                                                                            const checked = set.has(ch);
                                                                            return (
                                                                                <label key={ch} className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={checked}
                                                                                        onChange={(e) => {
                                                                                            const next = new Set(set);
                                                                                            if (e.target.checked) next.add(ch); else next.delete(ch);
                                                                                            handleFieldChange(
                                                                                                r.notifyId,
                                                                                                'alarmType',
                                                                                                ['device', 'line'].filter(x => next.has(x)).join(',')
                                                                                            );
                                                                                        }}
                                                                                        className="accent-blue-500"
                                                                                    />
                                                                                    {ch === 'device' ? 'Device' : 'LINE'}
                                                                                </label>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </td>
                                                                <td className="p-2 text-right">
                                                                    <button
                                                                        onClick={() => handleDeleteRow(r.notifyId)}
                                                                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                                                        title="Delete row"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>

                                            {/* Add-level footer — only shown when the dbKey has missing levels */}
                                            {group.missingLevels.length > 0 && (
                                                <div className="px-3 py-2 bg-slate-900/40 border-t border-slate-700 flex items-center gap-2 text-sm">
                                                    <span className="text-slate-400 flex items-center gap-1">
                                                        <Plus size={14} /> Add level:
                                                    </span>
                                                    <select
                                                        value={pickedLevel}
                                                        onChange={(e) => setAddPickerLevel(prev => ({ ...prev, [group.dbKey]: e.target.value }))}
                                                        className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                                    >
                                                        {group.missingLevels.map(L => (
                                                            <option key={L} value={L}>{L}</option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => handleAddRow(group.dbKey, pickedLevel)}
                                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition-colors"
                                                    >
                                                        Add
                                                    </button>
                                                    <span className="text-slate-500 text-xs ml-auto">
                                                        เหลือ: {group.missingLevels.join(', ')}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-700 flex justify-end items-center gap-3 shrink-0">
                            {totalErrors > 0 && (
                                <span className="text-red-400 text-sm mr-auto">
                                    ⚠ พบ {totalErrors} จุดที่ค่า point ไม่ถูกต้องตาม level
                                </span>
                            )}
                            <button
                                onClick={closeEdit}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || editRows.length === 0 || totalErrors > 0}
                                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                                    saving || editRows.length === 0 || totalErrors > 0
                                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}
                                title={totalErrors > 0 ? `แก้ไข ${totalErrors} จุดก่อนบันทึก` : ''}
                            >
                                {saving
                                    ? <div className="w-4 h-4 border-2 border-slate-400 border-t-blue-400 rounded-full animate-spin"></div>
                                    : <Save size={18} />}
                                <span>{saving ? 'Saving...' : 'ยืนยันการแก้ไข'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Subscription modal (design variant). Logic is shared from Layout
                via SubscriptionContext, so this stays in sync with the header button. */}
            <SubscriptionModalV2
                open={subModalOpen}
                onClose={() => setSubModalOpen(false)}
                currentTier={subscription.currentTier}
                webPushSubscribed={subscription.webPushSubscribed}
                channelStatus={subscription.channelStatus}
                onSubmit={subscription.onSubmit}
                onSendTest={subscription.onSendTest}
                devices={subscription.webPushDevices}
                currentDeviceId={subscription.currentDeviceId}
                onRemoveDevice={subscription.onRemoveDevice}
            />
        </div>
    );
};

export default NotifyConfig;
