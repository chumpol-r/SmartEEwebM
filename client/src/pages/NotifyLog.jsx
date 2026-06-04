import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { ClipboardList, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, FileDown, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

const PAGE_SIZE = 50;

const LEVEL_COLORS = {
    'Very High': 'bg-red-500/20 text-red-400 border-red-500/30',
    'High':      'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'Normal':    'bg-green-500/20 text-green-400 border-green-500/30',
    'Low':       'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'Very Low':  'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const STATUS_COLORS = {
    'sent':    'bg-green-500/20 text-green-400 border-green-500/30',
    'pending': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'failed':  'bg-red-500/20 text-red-400 border-red-500/30',
};

// Alarm lifecycle event type — raise/escalate are "active" colors, cleared
// uses cool/positive colors so the user can scan the log at a glance.
const EVENT_TYPE_COLORS = {
    'raise':    'bg-red-500/20 text-red-400 border-red-500/30',
    'escalate': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'cleared':  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};
const EVENT_TYPE_LABELS = {
    'raise':    'Raised',
    'escalate': 'Escalated',
    'cleared':  'Cleared',
};

const EVENT_TYPE_FILTERS = ['all', 'raise', 'escalate', 'cleared'];

function fmt(dt) {
    if (!dt) return '-';
    const match = String(dt).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (!match) return String(dt);
    const [, year, month, day, hour, min, sec] = match;
    return `${day}/${month}/${year}, ${hour}:${min}:${sec}`;
}

function Badge({ value, colorMap }) {
    const cls = colorMap[value] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
            {value || '-'}
        </span>
    );
}

// --- Date range helpers ---
// We compare on the raw `YYYY-MM-DDTHH:MM` substring (no timezone math) so the
// range matches exactly what `fmt()` displays — keeps client-side filtering
// consistent with the grid no matter how mssql formats the ISO output.
function pad2(n) { return String(n).padStart(2, '0'); }
function todayStartInput() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T00:00`;
}
function todayEndInput() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T23:59`;
}
function toMinuteKey(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null;
}
// Render "2026-05-23T14:30" as "23/05/2026 14:30" (browser-locale-independent).
function fmtKeyDisplay(key) {
    const m = key && key.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : '';
}

// Custom field: shows dd/mm/yyyy HH:MM in a readOnly text box, opens the
// native datetime-local picker on click. Browsers won't let us override the
// native input's display format, so we layer a text input on top.
function DateTimeField({ value, onChange }) {
    const pickerRef = useRef(null);
    const openPicker = () => {
        const el = pickerRef.current;
        if (!el) return;
        if (typeof el.showPicker === 'function') {
            try { el.showPicker(); } catch { el.focus(); }
        } else {
            el.focus();
        }
    };
    return (
        <div className="relative inline-block">
            <input
                type="text"
                readOnly
                value={fmtKeyDisplay(value)}
                placeholder="dd/mm/yyyy HH:MM"
                onClick={openPicker}
                onFocus={openPicker}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 cursor-pointer w-44"
            />
            <input
                ref={pickerRef}
                type="datetime-local"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-hidden="true"
                tabIndex={-1}
                className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
            />
        </div>
    );
}
// NOTE: If NotifyLog grows past ~10k rows this filter should move server-side
// (add fromDate/toDate query params + an index on event_time DESC).

const NotifyLog = () => {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageInput, setPageInput] = useState('1');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [fromDate, setFromDate] = useState(todayStartInput);
    const [toDate, setToDate] = useState(todayEndInput);
    const [eventTypeFilter, setEventTypeFilter] = useState('all');

    // Keep pageInput in sync when page changes externally (Prev/Next/First/Last).
    useEffect(() => { setPageInput(String(page)); }, [page]);

    const commitPageInput = () => {
        const v = parseInt(pageInput, 10);
        if (!Number.isNaN(v)) setPage(Math.max(1, Math.min(totalPages, v)));
        else setPageInput(String(page));
    };

    // 200ms debounce so the spinner has meaning and we re-filter once per pause.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm), 200);
        return () => clearTimeout(t);
    }, [searchTerm]);
    const isSearching = searchTerm !== debouncedSearch;

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    const fetchPage = useCallback(async (p, showSpinner = true) => {
        if (showSpinner) setLoading(true);
        try {
            // /api/notify-log scopes results to the logged-in user's c_id
            // server-side, so we just need to pass the bearer token. A token
            // missing here means the user is signed out or session expired —
            // surface that with a clear empty state instead of a silent error.
            const token = localStorage.getItem('token');
            if (!token) {
                setRows([]);
                setTotal(0);
                return;
            }
            const res = await axios.get('/api/notify-log', {
                params: { page: p, pageSize: PAGE_SIZE },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data?.success) {
                setRows(res.data.data || []);
                setTotal(res.data.total || 0);
            }
        } catch (err) {
            console.error('Error fetching notify log:', err);
            // 401/403 means the session is bad or the user has no c_id —
            // wipe stale rows so the UI doesn't show another org's data
            // from a previous fetch.
            if (err.response?.status === 401 || err.response?.status === 403) {
                setRows([]);
                setTotal(0);
            }
        } finally {
            if (showSpinner) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPage(page);
    }, [page, fetchPage]);

    const handleRefresh = () => {
        setSearchTerm('');
        setDebouncedSearch('');
        setFromDate(todayStartInput());
        setToDate(todayEndInput());
        setEventTypeFilter('all');
        fetchPage(page, true);
    };

    const handleClearRange = () => {
        setFromDate('');
        setToDate('');
    };

    const handleExportExcel = () => {
        const data = filteredRows.map(r => ({
            'Serial':         r.mqttSerial || '',
            'Data':           r.dbkey || '',
            'Level':          r.level || '',
            'Event':          EVENT_TYPE_LABELS[r.eventType] || r.eventType || '',
            'Correlation ID': r.correlationId ?? '',
            'Value':          r.value ?? '',
            'Point':          r.point ?? '',
            'Message':        r.message || '',
            'Alarm Type':     r.alarmType || '',
            'Status':         r.status || '',
            'Failure Reason': r.failReason || '',
            'Event Time':     r.eventTime ? fmt(r.eventTime) : '',
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'NotifyLog');
        const fileName = `notify-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    // Client-side filtering: date range first (only when both ends are set),
    // then text search. String-key comparison on YYYY-MM-DDTHH:MM avoids any
    // timezone conversion so the range matches what `fmt()` renders.
    const search = debouncedSearch.trim().toLowerCase();
    const fromKey = toMinuteKey(fromDate);
    const toKey = toMinuteKey(toDate);
    const dateRangeActive = !!(fromKey && toKey);
    const invalidRange = dateRangeActive && fromKey > toKey;

    const filteredRows = rows.filter(r => {
        // 1) date range — both ends required
        if (dateRangeActive && !invalidRange) {
            const k = toMinuteKey(r.eventTime);
            if (!k || k < fromKey || k > toKey) return false;
        }
        // 2) event_type filter
        if (eventTypeFilter !== 'all' && r.eventType !== eventTypeFilter) return false;
        // 3) text search
        if (search) {
            const hit =
                (r.mqttSerial || '').toLowerCase().includes(search) ||
                (r.dbkey || '').toLowerCase().includes(search) ||
                (r.level || '').toLowerCase().includes(search) ||
                (r.message || '').toLowerCase().includes(search) ||
                (r.alarmType || '').toLowerCase().includes(search) ||
                (r.status || '').toLowerCase().includes(search) ||
                (r.failReason || '').toLowerCase().includes(search) ||
                (r.eventType || '').toLowerCase().includes(search);
            if (!hit) return false;
        }
        return true;
    });

    // 100dvh - 7rem = Layout header (h-16 = 4rem) + Layout p-6 vertical padding (3rem). Adjust if Layout changes.
    return (
        <div className="h-[calc(100dvh-7rem)] flex flex-col gap-4 max-w-full">
            {/* Header */}
            <div className="flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ClipboardList size={24} /> Notify Log
                    </h1>
                    <p className="text-slate-400">ประวัติการแจ้งเตือนทั้งหมด ({total} รายการ)</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExportExcel}
                        disabled={filteredRows.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                        <FileDown size={18} />
                        <span>Export Excel</span>
                    </button>
                    <button
                        onClick={handleRefresh}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Search Bar + Date Range */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3 shrink-0">
                <div className="flex gap-3 flex-wrap items-center">
                    <div className="relative flex-1 min-w-60">
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
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <label className="text-slate-400 text-xs">Event</label>
                        <select
                            value={eventTypeFilter}
                            onChange={(e) => setEventTypeFilter(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                            title="Filter by event type"
                        >
                            {EVENT_TYPE_FILTERS.map(t => (
                                <option key={t} value={t}>
                                    {t === 'all' ? 'All events' : EVENT_TYPE_LABELS[t]}
                                </option>
                            ))}
                        </select>
                        <label className="text-slate-400 text-xs ml-2">From</label>
                        <DateTimeField value={fromDate} onChange={setFromDate} />
                        <span className="text-slate-500">→</span>
                        <label className="text-slate-400 text-xs">To</label>
                        <DateTimeField value={toDate} onChange={setToDate} />
                        <button
                            onClick={handleClearRange}
                            disabled={!fromDate && !toDate}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
                            title="Clear date range"
                        >
                            Clear
                        </button>
                    </div>
                </div>
                {invalidRange && (
                    <p className="text-amber-400 text-xs">⚠ ช่วงเวลาไม่ถูกต้อง: From มากกว่า To (filter ถูกข้าม)</p>
                )}
                {dateRangeActive && !invalidRange && (
                    <p className="text-slate-500 text-xs">
                        กรองช่วง <span className="text-cyan-400">{fmtKeyDisplay(fromKey)}</span> → <span className="text-cyan-400">{fmtKeyDisplay(toKey)}</span>
                    </p>
                )}
            </div>

            {/* Table — grows to fill, scrolls internally */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
                            <tr className="border-b border-slate-700 text-slate-400 font-medium">
                                <th className="px-3 py-3 whitespace-nowrap">Serial</th>
                                <th className="px-3 py-3 whitespace-nowrap">Data</th>
                                <th className="px-3 py-3 whitespace-nowrap">Level</th>
                                <th className="px-3 py-3 whitespace-nowrap">Event</th>
                                <th className="px-3 py-3 whitespace-nowrap text-right">Value</th>
                                <th className="px-3 py-3 whitespace-nowrap text-right">Point</th>
                                <th className="px-3 py-3">Message</th>
                                <th className="px-3 py-3 whitespace-nowrap">Channels</th>
                                <th className="px-3 py-3 whitespace-nowrap">Status</th>
                                <th className="px-3 py-3">Failure Reason</th>
                                <th className="px-3 py-3 whitespace-nowrap">Event Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="11" className="py-12 text-center text-slate-400">
                                        <RefreshCw size={20} className="animate-spin inline mr-2" />
                                        Loading...
                                    </td>
                                </tr>
                            ) : filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan="11" className="py-12 text-center text-slate-400">
                                        {search && dateRangeActive && !invalidRange ? (
                                            <>
                                                <div className="mb-2">
                                                    ไม่พบ <span className="text-white">&quot;{searchTerm}&quot;</span> ในช่วง{' '}
                                                    <span className="text-cyan-400">{fmtKeyDisplay(fromKey)}</span> →{' '}
                                                    <span className="text-cyan-400">{fmtKeyDisplay(toKey)}</span>
                                                </div>
                                                <button
                                                    onClick={handleClearRange}
                                                    className="text-cyan-400 hover:text-cyan-300 underline text-xs"
                                                >
                                                    ค้นหาทั้งหมด (ล้างช่วงเวลา)
                                                </button>
                                            </>
                                        ) : search ? (
                                            <>ไม่พบข้อมูลที่ตรงกับ &quot;{searchTerm}&quot;</>
                                        ) : dateRangeActive && !invalidRange ? (
                                            <>
                                                <div className="mb-2">
                                                    ไม่มีข้อมูลในช่วง{' '}
                                                    <span className="text-cyan-400">{fmtKeyDisplay(fromKey)}</span> →{' '}
                                                    <span className="text-cyan-400">{fmtKeyDisplay(toKey)}</span>
                                                </div>
                                                <button
                                                    onClick={handleClearRange}
                                                    className="text-cyan-400 hover:text-cyan-300 underline text-xs"
                                                >
                                                    ดูข้อมูลทั้งหมด (ล้างช่วงเวลา)
                                                </button>
                                            </>
                                        ) : (
                                            'ไม่มีข้อมูล'
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.map(r => (
                                    <tr
                                        key={r.logId}
                                        className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors"
                                    >
                                        <td className="px-3 py-2.5 font-mono text-cyan-400">{r.mqttSerial || '-'}</td>
                                        <td className="px-3 py-2.5 font-semibold text-white">{r.dbkey || '-'}</td>
                                        <td className="px-3 py-2.5">
                                            <Badge value={r.level} colorMap={LEVEL_COLORS} />
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span
                                                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${EVENT_TYPE_COLORS[r.eventType] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}
                                                title={r.correlationId ? `Linked to log #${r.correlationId}` : 'Original alarm'}
                                            >
                                                {EVENT_TYPE_LABELS[r.eventType] || r.eventType || '-'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono text-white">
                                            {r.value != null ? r.value.toLocaleString() : '-'}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                                            {r.point != null ? r.point.toLocaleString() : '-'}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-200 max-w-xs truncate" title={r.message}>
                                            {r.message || '-'}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {(() => {
                                                const chans = String(r.alarmType || '')
                                                    .toLowerCase()
                                                    .split(',')
                                                    .map(s => s.trim())
                                                    .filter(Boolean);
                                                if (chans.length === 0) return <span className="text-slate-500">-</span>;
                                                const styleFor = (c) =>
                                                    c === 'device' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                                    : c === 'line' ? 'bg-green-500/15 text-green-300 border-green-500/30'
                                                    : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
                                                const labelFor = (c) => c === 'device' ? 'Device' : c === 'line' ? 'LINE' : c;
                                                return (
                                                    <div className="flex flex-wrap gap-1">
                                                        {chans.map(c => (
                                                            <span key={c} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${styleFor(c)}`}>
                                                                {labelFor(c)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <Badge value={r.status} colorMap={STATUS_COLORS} />
                                        </td>
                                        <td className="px-3 py-2.5 max-w-xs">
                                            {r.failReason ? (
                                                <span className="text-red-300 text-xs leading-snug block truncate" title={r.failReason}>
                                                    {r.failReason}
                                                </span>
                                            ) : (
                                                <span className="text-slate-600">-</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-xs">{fmt(r.eventTime)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination — pinned at bottom of card */}
                <div className="shrink-0 px-4 py-3 border-t border-slate-700 flex items-center justify-between text-sm text-slate-400 bg-slate-900/30">
                    <span>
                        แสดง <span className="text-white font-semibold">{filteredRows.length}</span>
                        {search || dateRangeActive
                            ? <> รายการ (กรองแล้ว จาก {rows.length} ในหน้านี้)</>
                            : <> จาก <span className="text-white font-semibold">{total}</span> รายการทั้งหมด</>}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage(1)}
                            disabled={page === 1}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="หน้าแรก"
                        >
                            <ChevronsLeft size={18} />
                        </button>
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="ก่อนหน้า"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className="flex items-center gap-1 mx-1 text-slate-400">
                            หน้า
                            <input
                                type="number"
                                min={1}
                                max={totalPages}
                                value={pageInput}
                                onChange={(e) => setPageInput(e.target.value)}
                                onBlur={commitPageInput}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput(); }}
                                aria-label="ระบุเลขหน้าเพื่อกระโดด"
                                className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono text-sm focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="text-slate-500">/</span>
                            <span className="font-mono text-slate-300">{totalPages}</span>
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="ถัดไป"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <button
                            onClick={() => setPage(totalPages)}
                            disabled={page === totalPages}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="หน้าสุดท้าย"
                        >
                            <ChevronsRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NotifyLog;
