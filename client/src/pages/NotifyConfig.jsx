import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Search, Edit2, Trash2, X, Save, RefreshCw, Bell } from 'lucide-react';
import { useToast } from '../components/Toast';

const ALARM_TYPES = ['Dialog', 'Email', 'SMS'];
const REFRESH_INTERVAL_MS = 5000;

// Display order (top → bottom). Lower index = higher in the table.
const LEVEL_ORDER = ['Very High', 'High', 'Normal', 'Low', 'Very Low'];
const levelRank = (lvl) => {
    const i = LEVEL_ORDER.indexOf(lvl);
    return i === -1 ? 99 : i;
};

const NotifyConfig = () => {
    const toast = useToast();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Edit modal state
    const [editingGroup, setEditingGroup] = useState(null); // { serialId, serialName }
    const [editRows, setEditRows] = useState([]);            // editable copy of the group's rows
    const [saving, setSaving] = useState(false);

    const modalOpenRef = useRef(false);
    modalOpenRef.current = editingGroup !== null;

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

    // Group rows by serial_id
    const groupsMap = rows.reduce((acc, row) => {
        const key = row.serialId;
        if (!acc[key]) {
            acc[key] = { serialId: row.serialId, serialName: row.serialName, rows: [] };
        }
        acc[key].rows.push(row);
        return acc;
    }, {});
    const groups = Object.values(groupsMap);

    const search = searchTerm.trim().toLowerCase();
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
    };

    const closeEdit = () => {
        setEditingGroup(null);
        setEditRows([]);
    };

    const handleFieldChange = (notifyId, field, value) => {
        setEditRows(prev => prev.map(r =>
            r.notifyId === notifyId ? { ...r, [field]: value } : r
        ));
    };

    const handleDeleteRow = async (notifyId) => {
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

    // Group the editing rows by dbkey, levels sorted Very High → Very Low within each box
    const dbKeyGroups = Object.values(
        editRows.reduce((acc, r) => {
            if (!acc[r.dbKey]) acc[r.dbKey] = { dbKey: r.dbKey, rows: [] };
            acc[r.dbKey].rows.push(r);
            return acc;
        }, {})
    ).map(g => ({
        ...g,
        rows: [...g.rows].sort((a, b) => levelRank(a.level) - levelRank(b.level))
    }));

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const payload = editRows.map(r => ({
                notifyId: r.notifyId,
                point: Number(r.point) || 0,
                delay: Number(r.delay) || 0,
                message: r.message || '',
                alarmType: r.alarmType || ''
            }));
            await axios.post('/api/notify/update', payload);
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

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Bell size={24} /> Notify Config
                    </h1>
                    <p className="text-slate-400">จัดการการแจ้งเตือนของแต่ละ Serial</p>
                </div>
                <button
                    onClick={() => fetchAll(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                    <RefreshCw size={18} />
                    <span>Refresh</span>
                </button>
            </div>

            {/* Search */}
            <div className="flex gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by ..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Grid grouped by serial */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-900/50 border-b border-slate-700">
                                <th className="p-4 text-slate-400 font-medium">Serial ID</th>
                                <th className="p-4 text-slate-400 font-medium">Serial Name</th>
                                <th className="p-4 text-slate-400 font-medium">Configs</th>
                                <th className="p-4 text-slate-400 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="4" className="p-8 text-center text-slate-400">Loading...</td></tr>
                            ) : filteredGroups.length === 0 ? (
                                <tr><td colSpan="4" className="p-8 text-center text-slate-400">ไม่พบข้อมูล</td></tr>
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
            </div>

            {/* Edit Group Modal */}
            {editingGroup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
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
                                dbKeyGroups.map(group => (
                                    <div key={group.dbKey} className="border border-slate-700 rounded-lg overflow-hidden">
                                        <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-700 font-semibold text-blue-400">
                                            {group.dbKey}
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="bg-slate-900/40 border-b border-slate-700 text-slate-400">
                                                    <th className="p-2">level</th>
                                                    <th className="p-2 w-28">point</th>
                                                    <th className="p-2 w-24">delay</th>
                                                    <th className="p-2">message</th>
                                                    <th className="p-2 w-32">alarm type</th>
                                                    <th className="p-2 w-12"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.rows.map(r => {
                                                    const isNormal = r.level === 'Normal';
                                                    return (
                                                        <tr key={r.notifyId} className="border-b border-slate-700 last:border-b-0">
                                                            <td className="p-2 text-slate-300">{r.level}</td>
                                                            <td className="p-2">
                                                                {isNormal ? (
                                                                    <span className="text-slate-500">-</span>
                                                                ) : (
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={r.point}
                                                                        onChange={(e) => handleFieldChange(r.notifyId, 'point', e.target.value)}
                                                                        className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
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
                                                                    onChange={(e) => handleFieldChange(r.notifyId, 'message', e.target.value)}
                                                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                                                />
                                                            </td>
                                                            <td className="p-2">
                                                                <select
                                                                    value={r.alarmType}
                                                                    onChange={(e) => handleFieldChange(r.notifyId, 'alarmType', e.target.value)}
                                                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                                                >
                                                                    <option value="">Select...</option>
                                                                    {ALARM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                                </select>
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
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-700 flex justify-end gap-3 shrink-0">
                            <button
                                onClick={closeEdit}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || editRows.length === 0}
                                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                                    saving || editRows.length === 0
                                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}
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
        </div>
    );
};

export default NotifyConfig;
