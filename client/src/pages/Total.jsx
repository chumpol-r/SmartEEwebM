import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit, Trash2, Save, X, Layers } from 'lucide-react';
import { useToast } from '../components/Toast';

const Total = () => {
    const toast = useToast();
    const [groups, setGroups] = useState([]);
    const [sites, setSites] = useState([]);
    const [meters, setMeters] = useState([]);
    const [loading, setLoading] = useState(false);

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);

    // Form State
    const [newGroup, setNewGroup] = useState({ name: '', siteId: '' });
    const [editingGroup, setEditingGroup] = useState(null); // { id, name, items: [] }
    const [editItems, setEditItems] = useState([]); // [{ meterId, multiplier, name }]

    // Fetch Initial Data
    useEffect(() => {
        fetchGroups();
        fetchSites();
        fetchMeters();
    }, []);

    const fetchGroups = async () => {
        setLoading(true);
        try {
            console.log("Fetching groups...");
            const res = await axios.get('/api/total/groups', { params: { siteCode: '%' } });
            console.log("Groups fetched:", res.data);
            if (Array.isArray(res.data)) {
                setGroups(res.data);
            } else {
                console.error("Groups response is not an array:", res.data);
                setGroups([]);
            }
        } catch (err) {
            console.error("Failed to fetch groups", err);
            toast.error('Failed to fetch groups. Check console for details.');
        } finally {
            setLoading(false);
        }
    };

    const fetchSites = async () => {
        try {
            console.log("Fetching sites...");
            const res = await axios.get('/api/sites', { params: { siteCode: '%' } });
            console.log("Sites fetched:", res.data);
            if (Array.isArray(res.data)) {
                setSites(res.data);
            } else {
                console.error("Sites response is not an array:", res.data);
                setSites([]);
            }
        } catch (err) {
            console.error("Failed to fetch sites", err);
        }
    };

    const fetchMeters = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/meters', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (Array.isArray(res.data)) {
                // Process meters to match legacy logic (remove Domain\ prefix)
                const processedMeters = res.data.map(m => {
                    let serial = m.serial || m.val;
                    if (typeof serial === 'string' && serial.includes('\\')) {
                        serial = serial.split('\\')[1];
                    }
                    return {
                        ...m,
                        val: serial, // Use cleaned serial as the value
                        originalId: m.val
                    };
                });
                setMeters(processedMeters);
            }
        } catch (err) {
            console.error("Failed to fetch meters", err);
        }
    };

    // Create Group
    const handleCreate = async () => {
        if (!newGroup.name || !newGroup.siteId) {
            toast.warning('Please fill all fields');
            return;
        }
        try {
            await axios.post('/api/total/groups', newGroup);
            setShowCreateModal(false);
            setNewGroup({ name: '', siteId: '' });
            toast.success('Group created successfully!');
            fetchGroups();
        } catch (err) {
            console.error(err);
            toast.error('Failed to create group');
        }
    };

    // Delete Group
    const handleDelete = async (id) => {
        const confirmed = await toast.confirm('Are you sure you want to delete this group?', {
            title: 'Delete Group',
            type: 'error',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        try {
            await axios.delete(`/api/total/groups/${id}`);
            toast.success('Group deleted successfully!');
            fetchGroups();
        } catch (err) {
            console.error(err);
            toast.error('Failed to delete group');
        }
    };

    // Edit Group
    const handleEditClick = async (id) => {
        try {
            const res = await axios.get(`/api/total/groups/${id}`);
            const { header, items } = res.data;
            setEditingGroup({
                id: header.n_id,
                name: header.c_group_name
            });

            // Map items to state format
            const mappedItems = items.map(item => {
                let serial = item.c_serial_id;
                if (typeof serial === 'string' && serial.includes('\\')) {
                    serial = serial.split('\\')[1];
                }
                return {
                    meterId: serial,
                    multiplier: item.n_multiple,
                    name: item.c_meter_name
                };
            });
            setEditItems(mappedItems);
            setShowEditModal(true);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load group details');
        }
    };

    const handleSaveEdit = async () => {
        try {
            // Enrich items with names from meters list if missing
            const enrichedItems = editItems.map(item => {
                const m = meters.find(m => m.val === item.meterId);
                return {
                    ...item,
                    name: m ? (m.displayName || m.name) : item.name
                };
            });

            await axios.put(`/api/total/groups/${editingGroup.id}`, {
                name: editingGroup.name,
                items: enrichedItems
            });
            setShowEditModal(false);
            toast.success('Group updated successfully!');
            fetchGroups();
        } catch (err) {
            console.error(err);
            toast.error('Failed to update group');
        }
    };

    // Item Management in Edit Modal
    const addItem = () => {
        setEditItems([...editItems, { meterId: '', multiplier: 1, name: '' }]);
    };

    const removeItem = (index) => {
        const newItems = [...editItems];
        newItems.splice(index, 1);
        setEditItems(newItems);
    };

    const updateItem = (index, field, value) => {
        const newItems = [...editItems];
        newItems[index][field] = value;
        setEditItems(newItems);
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Layers className="text-blue-400" /> Total Meter Management
                </h1>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                >
                    <Plus size={18} /> Add New Group
                </button>
            </div>

            {/* Groups Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-900 text-slate-400 uppercase font-medium">
                        <tr>
                            <th className="px-6 py-4">Group Name</th>
                            <th className="px-6 py-4">Site Name</th>
                            <th className="px-6 py-4 text-center">Sub-Meters</th>
                            <th className="px-6 py-4 text-center">Active</th>
                            <th className="px-6 py-4">Created Date</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {groups.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-8 text-center text-slate-500">
                                    No groups found. Create one to get started.
                                </td>
                            </tr>
                        ) : (
                            groups.map((group) => (
                                <tr key={group.n_id} className="hover:bg-slate-700/50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-white">{group.c_group_name}</td>
                                    <td className="px-6 py-4">{group.c_site_name}</td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="bg-slate-700 px-2 py-1 rounded text-xs text-white">
                                            {group.c_tap_row}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {group.c_group_active === 'Y' ? (
                                            <span className="text-green-400">Active</span>
                                        ) : (
                                            <span className="text-red-400">Inactive</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">{group.c_date}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button
                                            onClick={() => handleEditClick(group.n_id)}
                                            className="text-blue-400 hover:text-blue-300 p-1"
                                            title="Edit"
                                        >
                                            <Edit size={18} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(group.n_id)}
                                            className="text-red-400 hover:text-red-300 p-1"
                                            title="Delete"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white">Create New Group</h2>
                            <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Group Name</label>
                                <input
                                    type="text"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={newGroup.name}
                                    onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                                    placeholder="Enter group name"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Site</label>
                                <select
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={newGroup.siteId}
                                    onChange={(e) => setNewGroup({ ...newGroup, siteId: e.target.value })}
                                >
                                    <option value="">Select Site</option>
                                    {sites.map(site => (
                                        <option key={site.val} value={site.val}>{site.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end gap-3">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg"
                            >
                                Create Group
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {showEditModal && editingGroup && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-4xl p-6 max-h-[90vh] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white">Edit Group: {editingGroup.name}</h2>
                            <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm text-slate-400 mb-1">Group Name</label>
                            <input
                                type="text"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                value={editingGroup.name}
                                onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 mb-6 border border-slate-700 rounded-lg bg-slate-900/50">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-900 text-slate-400 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-2">Meter</th>
                                        <th className="px-4 py-2 w-32">Multiplier</th>
                                        <th className="px-4 py-2 w-16"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700">
                                    {editItems.map((item, index) => (
                                        <tr key={index}>
                                            <td className="px-4 py-2">
                                                <select
                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                                    value={item.meterId}
                                                    onChange={(e) => updateItem(index, 'meterId', e.target.value)}
                                                >
                                                    <option value="">Select Meter</option>
                                                    {meters.map(m => (
                                                        <option key={m.val} value={m.val}>{m.displayName || m.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    step="0.000001"
                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500 text-right"
                                                    value={item.multiplier}
                                                    onChange={(e) => updateItem(index, 'multiplier', e.target.value)}
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    className="text-red-400 hover:text-red-300"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between items-center pt-4 border-t border-slate-700">
                            <button
                                onClick={addItem}
                                className="text-blue-400 hover:text-blue-300 flex items-center gap-2"
                            >
                                <Plus size={18} /> Add Meter
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowEditModal(false)}
                                    className="px-4 py-2 text-slate-300 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                                >
                                    <Save size={18} /> Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Total;
