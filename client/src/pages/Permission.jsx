import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Save, Plus, Check } from 'lucide-react';
import { useToast } from '../components/Toast';

const Permission = () => {
    const toast = useToast();
    const [sites, setSites] = useState([]);
    const [groups, setGroups] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [loading, setLoading] = useState(false);

    const [selectedSite, setSelectedSite] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [newGroupName, setNewGroupName] = useState('');

    useEffect(() => {
        fetchSites();
    }, []);

    useEffect(() => {
        if (selectedSite) {
            fetchGroups();
        }
    }, [selectedSite]);

    useEffect(() => {
        if (selectedSite && selectedGroup) {
            fetchPermissions();
        }
    }, [selectedSite, selectedGroup]);

    const fetchSites = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/sites', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSites(res.data);
            if (res.data.length > 0) {
                setSelectedSite(res.data[0].val);
            }
        } catch (err) {
            console.error("Failed to fetch sites", err);
        }
    };

    const fetchGroups = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/permissions/groups', {
                params: { siteCode: selectedSite },
                headers: { Authorization: `Bearer ${token}` }
            });
            setGroups(res.data);
            if (res.data.length > 0) {
                setSelectedGroup(res.data[0].val);
            } else {
                setSelectedGroup('');
                setPermissions([]);
            }
        } catch (err) {
            console.error("Failed to fetch groups", err);
        }
    };

    const fetchPermissions = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/permissions/matrix', {
                params: { siteCode: selectedSite, groupName: selectedGroup },
                headers: { Authorization: `Bearer ${token}` }
            });
            // Transform data for easier editing
            const mapped = res.data.map(p => ({
                menuId: p.menu,
                menuName: p.menuname,
                isExportedView: p.isExportedView === 1,
                view: p.view === 'Y',
                insert: p.insert === 'Y',
                update: p.update === 'Y',
                delete: p.delete === 'Y',
                admin: p.admin === 'Y'
            }));
            setPermissions(mapped);
        } catch (err) {
            console.error("Failed to fetch permissions", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateGroup = () => {
        if (!newGroupName) return;
        // Just add to local state to allow editing, will be saved when "Save Changes" is clicked
        const newGroup = { val: newGroupName, name: newGroupName };
        setGroups([...groups, newGroup]);
        setSelectedGroup(newGroupName);
        setNewGroupName('');
        // Also need to clear permissions or fetch default? 
        // Since it's new, fetching will return empty permissions (all false) from DB if we join left outer.
        // But wait, if it doesn't exist in DB, the query returns nothing?
        // The query uses WebMenu LEFT JOIN WebPermission. So it returns all menus with NULL permissions.
        // So fetching is fine.
    };

    const handlePermissionChange = (index, field) => {
        const newPerms = [...permissions];
        newPerms[index][field] = !newPerms[index][field];
        setPermissions(newPerms);
    };

    const handleSave = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.post('/api/permissions/matrix', {
                siteCode: selectedSite,
                groupName: selectedGroup,
                permissions: permissions
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Permissions saved successfully!');
            fetchGroups(); // Refresh groups in case it was a new one
        } catch (err) {
            console.error(err);
            toast.error('Failed to save permissions');
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Shield className="text-blue-400" /> Permission Management
                </h1>
            </div>

            {/* Controls */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-sm text-slate-400 mb-1">Site</label>
                    <select
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        value={selectedSite}
                        onChange={(e) => setSelectedSite(e.target.value)}
                    >
                        {sites.map(site => (
                            <option key={site.val} value={site.val}>{site.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 w-full">
                    <label className="block text-sm text-slate-400 mb-1">Permission Group</label>
                    <select
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        value={selectedGroup}
                        onChange={(e) => setSelectedGroup(e.target.value)}
                    >
                        {groups.map(group => (
                            <option key={group.val} value={group.val}>{group.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 w-full flex gap-2">
                    <div className="flex-1">
                        <label className="block text-sm text-slate-400 mb-1">New Group</label>
                        <input
                            type="text"
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            placeholder="Group Name"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={handleCreateGroup}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg mb-[1px] h-[42px] self-end"
                        title="Add Group"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            </div>

            {/* Matrix Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-white">Access Rights Matrix</h2>
                    <button
                        onClick={handleSave}
                        className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                    >
                        <Save size={18} /> Save Changes
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 uppercase font-medium">
                            <tr>
                                <th className="px-6 py-4">Menu</th>
                                <th className="px-6 py-4 text-center">View</th>
                                <th className="px-6 py-4 text-center">Insert</th>
                                <th className="px-6 py-4 text-center">Update</th>
                                <th className="px-6 py-4 text-center">Delete</th>
                                <th className="px-6 py-4 text-center">Admin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-slate-500">Loading permissions...</td>
                                </tr>
                            ) : permissions.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-slate-500">No permissions found. Select a group.</td>
                                </tr>
                            ) : (
                                permissions.map((perm, index) => {
                                    // Check if we need to show separator before this row
                                    const showSeparator = perm.isExportedView && (index === 0 || !permissions[index - 1].isExportedView);
                                    return (
                                        <React.Fragment key={perm.menuId}>
                                            {showSeparator && (
                                                <tr>
                                                    <td colSpan="6" className="px-6 py-3 bg-slate-900 border-t-2 border-blue-500">
                                                        <span className="text-blue-400 font-semibold text-sm uppercase tracking-wide">📋 Exported Views</span>
                                                    </td>
                                                </tr>
                                            )}
                                            <tr className="hover:bg-slate-700/50 transition-colors">
                                                <td className={`px-6 py-4 font-medium ${perm.isExportedView ? 'text-green-300' : 'text-white'}`}>{perm.menuName}</td>
                                                {['view', 'insert', 'update', 'delete', 'admin'].map(field => (
                                                    <td key={field} className="px-6 py-4 text-center">
                                                        <button
                                                            onClick={() => handlePermissionChange(index, field)}
                                                            className={`w-6 h-6 rounded border flex items-center justify-center transition-colors mx-auto ${perm[field]
                                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                                : 'bg-slate-900 border-slate-600 text-transparent hover:border-slate-500'
                                                                }`}
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                    </td>
                                                ))}
                                            </tr>
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Permission;
