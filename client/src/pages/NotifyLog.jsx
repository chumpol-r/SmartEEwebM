import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Search, FileDown } from 'lucide-react';
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

const NotifyLog = () => {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    const fetchPage = useCallback(async (p, showSpinner = true) => {
        if (showSpinner) setLoading(true);
        try {
            const res = await axios.get('/api/notify-log', {
                params: { page: p, pageSize: PAGE_SIZE }
            });
            if (res.data?.success) {
                setRows(res.data.data || []);
                setTotal(res.data.total || 0);
            }
        } catch (err) {
            console.error('Error fetching notify log:', err);
        } finally {
            if (showSpinner) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPage(page);
    }, [page, fetchPage]);

    const handleRefresh = () => {
        setSearchTerm('');
        fetchPage(page, true);
    };

    const handleExportExcel = () => {
        const data = filteredRows.map(r => ({
            'Serial':     r.mqttSerial || '',
            'Data':       r.dbkey || '',
            'Level':      r.level || '',
            'Value':      r.value ?? '',
            'Point':      r.point ?? '',
            'Message':    r.message || '',
            'Alarm Type': r.alarmType || '',
            'Status':     r.status || '',
            'Event Time': r.eventTime ? fmt(r.eventTime) : '',
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'NotifyLog');
        const fileName = `notify-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    // Client-side search across key fields
    const search = searchTerm.trim().toLowerCase();
    const filteredRows = search
        ? rows.filter(r =>
            (r.mqttSerial || '').toLowerCase().includes(search) ||
            (r.dbkey || '').toLowerCase().includes(search) ||
            (r.level || '').toLowerCase().includes(search) ||
            (r.message || '').toLowerCase().includes(search) ||
            (r.alarmType || '').toLowerCase().includes(search) ||
            (r.status || '').toLowerCase().includes(search)
        )
        : rows;

    return (
        <div className="space-y-6 max-w-full">
            {/* Header */}
            <div className="flex justify-between items-center">
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

            {/* Search Bar */}
            <div className="flex gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by ..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-slate-900/50 border-b border-slate-700 text-slate-400 font-medium">
                                <th className="px-3 py-3 whitespace-nowrap">Serial</th>
                                <th className="px-3 py-3 whitespace-nowrap">Data</th>
                                <th className="px-3 py-3 whitespace-nowrap">Level</th>
                                <th className="px-3 py-3 whitespace-nowrap text-right">Value</th>
                                <th className="px-3 py-3 whitespace-nowrap text-right">Point</th>
                                <th className="px-3 py-3">Message</th>
                                <th className="px-3 py-3 whitespace-nowrap">Alarm Type</th>
                                <th className="px-3 py-3 whitespace-nowrap">Status</th>
                                <th className="px-3 py-3 whitespace-nowrap">Event Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="9" className="py-12 text-center text-slate-400">
                                        <RefreshCw size={20} className="animate-spin inline mr-2" />
                                        Loading...
                                    </td>
                                </tr>
                            ) : filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="py-12 text-center text-slate-400">
                                        {search ? `ไม่พบข้อมูลที่ตรงกับ "${searchTerm}"` : 'ไม่มีข้อมูล'}
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
                                        <td className="px-3 py-2.5 text-right font-mono text-white">
                                            {r.value != null ? r.value.toLocaleString() : '-'}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                                            {r.point != null ? r.point.toLocaleString() : '-'}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-200 max-w-xs truncate" title={r.message}>
                                            {r.message || '-'}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-300">{r.alarmType || '-'}</td>
                                        <td className="px-3 py-2.5">
                                            <Badge value={r.status} colorMap={STATUS_COLORS} />
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-xs">{fmt(r.eventTime)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between text-sm text-slate-400">
                    <span>
                        หน้า {page} / {totalPages}
                        &nbsp;(แสดง {filteredRows.length}{search ? ` จากที่กรองแล้ว` : ` จาก ${total}`} รายการ)
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className="px-2 py-1 bg-slate-900 rounded font-mono">{page}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-1.5 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NotifyLog;
