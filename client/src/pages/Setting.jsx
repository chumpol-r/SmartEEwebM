import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Settings, Plus, Save, Trash2, Edit, Layers, Server, Cpu, ChevronRight, Search, X } from 'lucide-react';
import { useToast } from '../components/Toast';

// Filter Input Component - Defined outside to prevent re-creation on every render
const FilterInput = ({ value, onChange, placeholder }) => (
    <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="relative">
            <input
                type="text"
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg pl-8 pr-8 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-slate-800 transition-all"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            {value && (
                <button
                    onClick={() => onChange('')}
                    className="absolute right-2 top-2 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    </div>
);
const Setting = () => {
    const toast = useToast();
    // View Mode: 'group' (Group -> Site -> Serial) or 'serial' (Serial -> Site -> Group)
    const [viewMode, setViewMode] = useState('group');

    // Selection State
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [selectedSite, setSelectedSite] = useState(null);
    const [selectedSerial, setSelectedSerial] = useState(null);

    // Data State
    const [groups, setGroups] = useState([]);
    const [sites, setSites] = useState([]);
    const [serials, setSerials] = useState([]);

    // Loading State
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [loadingSites, setLoadingSites] = useState(false);
    const [loadingSerials, setLoadingSerials] = useState(false);

    // Edit/Add State
    const [editingItem, setEditingItem] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({});

    // Filter State (separate filter for each column)
    const [filterGroups, setFilterGroups] = useState('');
    const [filterSites, setFilterSites] = useState('');
    const [filterSerials, setFilterSerials] = useState('');

    // Link Management State
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [linkType, setLinkType] = useState(null);
    const [availableItems, setAvailableItems] = useState([]);
    const [selectedLinkIds, setSelectedLinkIds] = useState([]);

    // Site Action Menu State
    const [siteActionMenu, setSiteActionMenu] = useState({ open: false, x: 0, y: 0 });

    // Get auth headers
    const getAuthHeaders = () => {
        const token = localStorage.getItem('token');
        return { headers: { Authorization: `Bearer ${token}` } };
    };

    // Filtered items for each column
    const filteredGroups = useMemo(() => {
        if (!filterGroups.trim()) return groups;
        const q = filterGroups.toLowerCase();
        return groups.filter(g =>
            (g.c_name && g.c_name.toLowerCase().includes(q)) ||
            (g.c_id && g.c_id.toLowerCase().includes(q))
        );
    }, [groups, filterGroups]);

    const filteredSites = useMemo(() => {
        if (!filterSites.trim()) return sites;
        const q = filterSites.toLowerCase();
        return sites.filter(s =>
            (s.c_name && s.c_name.toLowerCase().includes(q)) ||
            (s.c_id && s.c_id.toLowerCase().includes(q))
        );
    }, [sites, filterSites]);

    const filteredSerials = useMemo(() => {
        if (!filterSerials.trim()) return serials;
        const q = filterSerials.toLowerCase();
        return serials.filter(s =>
            (s.c_serial_id && s.c_serial_id.toLowerCase().includes(q)) ||
            (s.c_name && s.c_name.toLowerCase().includes(q))
        );
    }, [serials, filterSerials]);

    // Initial Fetch based on Mode
    useEffect(() => {
        resetSelection();
        // Clear all filters when switching modes
        setFilterGroups('');
        setFilterSites('');
        setFilterSerials('');
        if (viewMode === 'group') {
            fetchGroups();
        } else {
            fetchAllSerials();
        }
    }, [viewMode]);

    const resetSelection = () => {
        setSelectedGroup(null);
        setSelectedSite(null);
        setSelectedSerial(null);
        setGroups([]);
        setSites([]);
        setSerials([]);
    };

    // --- API Fetchers ---

    const fetchGroups = async () => {
        setLoadingGroups(true);
        try {
            const res = await axios.get('/api/settings/groups', getAuthHeaders());
            setGroups(res.data);
        } catch (err) {
            console.error("Failed to fetch groups", err);
        } finally {
            setLoadingGroups(false);
        }
    };

    const fetchAllSerials = async () => {
        setLoadingSerials(true);
        try {
            const res = await axios.get('/api/settings/all-serials', getAuthHeaders());
            setSerials(res.data);
        } catch (err) {
            console.error("Failed to fetch all serials", err);
        } finally {
            setLoadingSerials(false);
        }
    };

    const fetchSitesByGroup = async (groupId) => {
        setLoadingSites(true);
        setFilterSites(''); // Clear filter when loading new data
        try {
            const res = await axios.get(`/api/settings/groups/${groupId}/sites`, getAuthHeaders());
            setSites(res.data);
        } catch (err) {
            console.error("Failed to fetch sites", err);
        } finally {
            setLoadingSites(false);
        }
    };

    const fetchSerialsBySite = async (siteId) => {
        setLoadingSerials(true);
        setFilterSerials(''); // Clear filter when loading new data
        try {
            const res = await axios.get(`/api/settings/sites/${siteId}/serials`, getAuthHeaders());
            setSerials(res.data);
        } catch (err) {
            console.error("Failed to fetch serials", err);
        } finally {
            setLoadingSerials(false);
        }
    };

    // --- Selection Handlers ---

    const handleGroupSelect = (group) => {
        setSelectedGroup(group);
        fetchSitesByGroup(group.c_id);
        setSites([]);
        setSerials([]);
        setSelectedSite(null);
        setSelectedSerial(null);
    };

    const handleSiteSelect = (site) => {
        setSelectedSite(site);
        fetchSerialsBySite(site.c_id);
        setSerials([]);
        setSelectedSerial(null);
    };

    const handleSerialSelect = (serial) => {
        setSelectedSerial(serial);
    };

    const handleSerialSelectReverse = async (serial) => {
        setSelectedSerial(serial);
        try {
            const res = await axios.get(`/api/settings/serial-details?id=${serial.c_id}`, getAuthHeaders());
            const { site, group } = res.data;

            if (site) {
                setSelectedSite(site);
                setSites([site]);

                if (group) {
                    setSelectedGroup(group);
                    setGroups([group]);
                } else {
                    setSelectedGroup(null);
                    setGroups([]);
                }
            } else {
                setSelectedSite(null);
                setSites([]);
                setSelectedGroup(null);
                setGroups([]);
            }
        } catch (err) {
            console.error("Failed to fetch details", err);
        }
    };

    // --- CRUD Handlers ---
    const handleAdd = (type, event) => {
        if (type === 'group') {
            setEditingItem({ type, data: null });
            setFormData({ name: '', active: true });
            setIsModalOpen(true);
        } else if (type === 'site') {
            // Show action menu for site
            if (event) {
                const rect = event.currentTarget.getBoundingClientRect();
                setSiteActionMenu({
                    open: true,
                    x: rect.left,
                    y: rect.bottom + 4
                });
            } else {
                handleManageLinks('site');
            }
        } else if (type === 'serial') {
            handleManageLinks('serial');
        }
    };

    // Add new site
    const handleAddNewSite = () => {
        setSiteActionMenu({ open: false, x: 0, y: 0 });
        setEditingItem({ type: 'site', data: null });
        setFormData({ name: '', active: true });
        setIsModalOpen(true);
    };

    // Link existing sites
    const handleLinkExistingSites = () => {
        setSiteActionMenu({ open: false, x: 0, y: 0 });
        handleManageLinks('site');
    };

    const handleManageLinks = async (type) => {
        setLinkType(type);
        setAvailableItems([]);
        setSelectedLinkIds([]);
        setIsLinkModalOpen(true);

        try {
            if (type === 'site') {
                const res = await axios.get('/api/settings/available-sites', getAuthHeaders());
                setAvailableItems(res.data);
                setSelectedLinkIds(sites.map(s => s.c_id));
            } else if (type === 'serial') {
                const res = await axios.get('/api/settings/available-serials', getAuthHeaders());
                setAvailableItems(res.data);
                setSelectedLinkIds(serials.map(s => s.c_id));
            }
        } catch (err) {
            console.error("Failed to fetch available items", err);
        }
    };

    const handleLinkToggle = (id) => {
        setSelectedLinkIds(prev => {
            if (prev.includes(id)) return prev.filter(i => i !== id);
            return [...prev, id];
        });
    };

    const handleSaveLinks = async () => {
        try {
            if (linkType === 'site') {
                await axios.post('/api/settings/links/group-site', {
                    groupId: selectedGroup.c_id,
                    siteIds: selectedLinkIds
                }, getAuthHeaders());
                fetchSitesByGroup(selectedGroup.c_id);
            } else if (linkType === 'serial') {
                await axios.post('/api/settings/links/site-serial', {
                    siteId: selectedSite.c_id,
                    serialIds: selectedLinkIds
                }, getAuthHeaders());
                fetchSerialsBySite(selectedSite.c_id);
            }
            setIsLinkModalOpen(false);
        } catch (err) {
            console.error("Failed to save links", err);
            toast.error('Failed to save links');
        }
    };

    const handleEdit = (type, item) => {
        setEditingItem({ type, data: item });
        setFormData({
            name: item.c_name,
            active: item.c_active === 'Y',
            serial: item.c_serial_id || ''
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (type, id) => {
        const typeLabel = type === 'group' ? 'Group' : type === 'site' ? 'Site' : 'Serial';
        const confirmMsg = type === 'serial'
            ? 'Remove this Serial from the site? It can be re-added later via the + button.'
            : `Are you sure you want to delete this ${typeLabel}?`;
        const confirmed = await toast.confirm(confirmMsg, {
            title: type === 'serial' ? 'Remove Serial from Site' : `Delete ${typeLabel}`,
            type: 'error',
            confirmText: type === 'serial' ? 'Remove' : 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        try {
            let res;
            if (type === 'group') {
                res = await axios.delete(`/api/settings/groups/${id}`, getAuthHeaders());
                if (res.data.success) {
                    toast.success(res.data.message || 'Group deleted successfully!');
                    fetchGroups();
                    setSelectedGroup(null);
                }
            } else if (type === 'site') {
                res = await axios.delete(`/api/settings/sites/${id}`, getAuthHeaders());
                if (res.data.success) {
                    toast.success(res.data.message || 'Site deleted successfully!');
                    if (viewMode === 'group') fetchSitesByGroup(selectedGroup.c_id);
                    setSelectedSite(null);
                }
            } else if (type === 'serial') {
                // Unlink from current site only — does NOT permanently delete the WebSerial record
                if (!selectedSite) return;
                res = await axios.delete(
                    `/api/settings/sites/${selectedSite.c_id}/serials/${id}`,
                    getAuthHeaders()
                );
                if (res.data.success) {
                    toast.success('Serial removed from site. It can be re-added via the + button.');
                    if (viewMode === 'group') fetchSerialsBySite(selectedSite.c_id);
                    else fetchAllSerials();
                }
            }
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.message || 'Failed to delete');
        }
    };

    const handleSave = async () => {
        try {
            const { type, data } = editingItem;
            const isEdit = !!data;
            const id = data?.c_id;

            let payload = {
                name: formData.name,
                active: formData.active
            };

            if (type === 'site' && selectedGroup) {
                payload.parentId = selectedGroup.c_id;
            } else if (type === 'serial' && selectedSite) {
                payload.parentId = selectedSite.c_id;
            }

            if (type === 'group') {
                if (isEdit) await axios.put(`/api/settings/groups/${id}`, payload, getAuthHeaders());
                else await axios.post('/api/settings/groups', payload, getAuthHeaders());
                if (viewMode === 'group') fetchGroups();
            } else if (type === 'site') {
                if (isEdit) {
                    await axios.put(`/api/settings/sites/${id}`, payload, getAuthHeaders());
                } else {
                    // Create new site
                    const res = await axios.post('/api/settings/sites', payload, getAuthHeaders());
                    // Auto-link to selected group
                    if (res.data.success && res.data.siteId && selectedGroup) {
                        const currentSiteIds = sites.map(s => s.c_id);
                        await axios.post('/api/settings/links/group-site', {
                            groupId: selectedGroup.c_id,
                            siteIds: [...currentSiteIds, res.data.siteId]
                        }, getAuthHeaders());
                    }
                }
                if (viewMode === 'group' && selectedGroup) fetchSitesByGroup(selectedGroup.c_id);
            } else if (type === 'serial') {
                payload.serial = formData.serial;
                if (isEdit) await axios.put(`/api/settings/serials/${id}`, payload, getAuthHeaders());
                if (viewMode === 'group' && selectedSite) fetchSerialsBySite(selectedSite.c_id);
                else fetchAllSerials();
            }

            setIsModalOpen(false);
            toast.success('Saved successfully!');
        } catch (err) {
            console.error(err);
            toast.error('Failed to save: ' + (err.response?.data?.message || err.message));
        }
    };

    // --- Render Item ---
    const renderItem = (item, type, isSelected, onSelect) => {
        const isInactive = type === 'serial' && item.smartboard_active !== undefined && item.smartboard_active === 0;

        return (
            <div
                key={item.c_id}
                onClick={() => onSelect && onSelect(item)}
                className={`
                flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border group
                ${isSelected
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                        : isInactive
                            ? 'bg-slate-900/30 border-slate-800 text-slate-600 opacity-75'
                            : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-700/50 hover:border-slate-600'}
            `}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    {type === 'group' && <Layers size={18} className={isSelected ? 'text-white' : 'text-blue-400'} />}
                    {type === 'site' && <Server size={18} className={isSelected ? 'text-white' : 'text-green-400'} />}
                    {type === 'serial' && <Cpu size={18} className={isSelected ? 'text-white' : isInactive ? 'text-slate-500' : 'text-purple-400'} />}

                    <div className="truncate">
                        <div className="font-medium truncate">{item.c_name || item.c_serial_id || '(No Name)'}</div>
                        {type === 'serial' && <div className="text-xs opacity-70">{item.c_serial_id}</div>}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${item.c_active === 'Y' && !isInactive ? 'bg-green-400' : 'bg-red-400'}`} />
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); handleEdit(type, item); }} className="p-1 hover:bg-white/20 rounded text-slate-200" title="Edit"><Edit size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(type, item.c_id); }} className="p-1 hover:bg-white/20 rounded text-red-400" title="Delete"><Trash2 size={14} /></button>
                    </div>
                    {onSelect && !isInactive && <ChevronRight size={16} className={`opacity-50 ${isSelected ? 'text-white' : ''}`} />}
                </div>
            </div>
        )
    };

    // --- Column Component ---
    const Column = ({ title, icon: Icon, iconColor, items, filteredItems, filterValue, setFilterValue, filterPlaceholder, loading, emptyMessage, selectedId, onSelect, onAdd, addColor, disabled }) => (
        <div className={`bg-slate-900/50 rounded-xl border border-slate-700 flex flex-col overflow-hidden transition-opacity ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                <h2 className="font-bold text-white flex items-center gap-2">
                    <Icon size={18} className={iconColor} /> {title}
                    {items.length > 0 && <span className="text-xs font-normal text-slate-400">({filteredItems.length}/{items.length})</span>}
                </h2>
                {onAdd && (
                    <button onClick={(e) => onAdd(e)} className={`${addColor} text-white p-1.5 rounded-lg transition-colors`}>
                        <Plus size={18} />
                    </button>
                )}
            </div>
            <FilterInput value={filterValue} onChange={setFilterValue} placeholder={filterPlaceholder} />
            <div className="p-3 space-y-2 overflow-y-auto flex-1">
                {loading ? (
                    <div className="text-center text-slate-500 py-4">Loading...</div>
                ) : filteredItems.length > 0 ? (
                    filteredItems.map(item => renderItem(item, title.toLowerCase().slice(0, -1), selectedId === item.c_id, onSelect))
                ) : (
                    <div className="text-center text-slate-500 py-10">
                        {filterValue ? `No matching ${title.toLowerCase()}` : emptyMessage}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="space-y-6 max-w-7xl mx-auto h-[calc(100vh-100px)] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Settings className="text-blue-400" /> System Settings
                </h1>

                <div className="bg-slate-800 p-1 rounded-lg border border-slate-700 flex items-center">
                    <button
                        onClick={() => setViewMode('group')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${viewMode === 'group' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Layers size={14} /> Group First
                    </button>
                    <button
                        onClick={() => setViewMode('serial')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${viewMode === 'serial' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Cpu size={14} /> Serial First
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {viewMode === 'group' ? (
                    <>
                        <Column
                            title="Groups"
                            icon={Layers}
                            iconColor="text-blue-400"
                            items={groups}
                            filteredItems={filteredGroups}
                            filterValue={filterGroups}
                            setFilterValue={setFilterGroups}
                            filterPlaceholder="Filter groups..."
                            loading={loadingGroups}
                            emptyMessage="No Groups"
                            selectedId={selectedGroup?.c_id}
                            onSelect={handleGroupSelect}
                            onAdd={() => handleAdd('group')}
                            addColor="bg-blue-600 hover:bg-blue-500"
                        />
                        <Column
                            title="Sites"
                            icon={Server}
                            iconColor="text-green-400"
                            items={sites}
                            filteredItems={filteredSites}
                            filterValue={filterSites}
                            setFilterValue={setFilterSites}
                            filterPlaceholder="Filter sites..."
                            loading={loadingSites}
                            emptyMessage={selectedGroup ? "No Sites" : "Select a Group"}
                            selectedId={selectedSite?.c_id}
                            onSelect={handleSiteSelect}
                            onAdd={(e) => handleAdd('site', e)}
                            addColor="bg-green-600 hover:bg-green-500"
                            disabled={!selectedGroup}
                        />
                        <Column
                            title="Serials"
                            icon={Cpu}
                            iconColor="text-purple-400"
                            items={serials}
                            filteredItems={filteredSerials}
                            filterValue={filterSerials}
                            setFilterValue={setFilterSerials}
                            filterPlaceholder="Filter serials..."
                            loading={loadingSerials}
                            emptyMessage={selectedSite ? "No Serials" : "Select a Site"}
                            selectedId={selectedSerial?.c_id}
                            onSelect={handleSerialSelect}
                            onAdd={selectedSite ? () => handleAdd('serial') : undefined}
                            addColor="bg-purple-600 hover:bg-purple-500"
                            disabled={!selectedSite}
                        />
                    </>
                ) : (
                    <>
                        <Column
                            title="Serials"
                            icon={Cpu}
                            iconColor="text-purple-400"
                            items={serials}
                            filteredItems={filteredSerials}
                            filterValue={filterSerials}
                            setFilterValue={setFilterSerials}
                            filterPlaceholder="Filter serials..."
                            loading={loadingSerials}
                            emptyMessage="No Serials"
                            selectedId={selectedSerial?.c_id}
                            onSelect={handleSerialSelectReverse}
                        />
                        <Column
                            title="Sites"
                            icon={Server}
                            iconColor="text-green-400"
                            items={sites}
                            filteredItems={filteredSites}
                            filterValue={filterSites}
                            setFilterValue={setFilterSites}
                            filterPlaceholder="Filter sites..."
                            loading={false}
                            emptyMessage={selectedSerial ? "No Linked Site" : "Select a Serial"}
                            selectedId={selectedSite?.c_id}
                            disabled={!selectedSerial}
                        />
                        <Column
                            title="Groups"
                            icon={Layers}
                            iconColor="text-blue-400"
                            items={groups}
                            filteredItems={filteredGroups}
                            filterValue={filterGroups}
                            setFilterValue={setFilterGroups}
                            filterPlaceholder="Filter groups..."
                            loading={false}
                            emptyMessage={selectedSite ? "No Linked Group" : "Select a Site"}
                            selectedId={selectedGroup?.c_id}
                            disabled={!selectedSite}
                        />
                    </>
                )}
            </div>

            {/* Link Management Modal */}
            {isLinkModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]">
                        <h2 className="text-xl font-bold text-white mb-4">
                            Manage {linkType === 'site' ? 'Sites' : 'Serials'} for {linkType === 'site' ? selectedGroup?.c_name : selectedSite?.c_name}
                        </h2>

                        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-2">
                            {availableItems.length === 0 ? (
                                <div className="text-center text-slate-500 py-10">No items available</div>
                            ) : (
                                availableItems.map(item => (
                                    <div
                                        key={item.c_id}
                                        onClick={() => handleLinkToggle(item.c_id)}
                                        className={`
                                            flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border
                                            ${selectedLinkIds.includes(item.c_id)
                                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-100'
                                                : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-700'}
                                        `}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`
                                                w-5 h-5 rounded border flex items-center justify-center transition-colors
                                                ${selectedLinkIds.includes(item.c_id) ? 'bg-blue-500 border-blue-500' : 'border-slate-600'}
                                            `}>
                                                {selectedLinkIds.includes(item.c_id) && <div className="w-2 h-2 bg-white rounded-full" />}
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{item.c_name || item.c_serial_id || '(No Name)'}</div>
                                                {item.c_serial_id && <div className="text-xs text-slate-400">{item.c_serial_id}</div>}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
                            <button
                                onClick={() => setIsLinkModalOpen(false)}
                                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveLinks}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2"
                            >
                                <Save size={18} /> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md shadow-2xl">
                        <h2 className="text-xl font-bold text-white mb-4">
                            {editingItem.data ? 'Edit' : 'Add'} {editingItem.type.charAt(0).toUpperCase() + editingItem.type.slice(1)}
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
                                <input
                                    type="text"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>

                            {editingItem.type === 'serial' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Serial ID <span className="text-slate-600 text-xs">(read-only)</span></label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-500 cursor-not-allowed select-none"
                                        value={formData.serial}
                                        readOnly
                                        disabled
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="active"
                                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                                    checked={formData.active}
                                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                                />
                                <label htmlFor="active" className="text-sm text-slate-300">Active</label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2"
                            >
                                <Save size={18} /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Site Action Menu */}
            {siteActionMenu.open && (
                <>
                    {/* Backdrop to close menu */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setSiteActionMenu({ open: false, x: 0, y: 0 })}
                    />
                    {/* Menu */}
                    <div
                        className="fixed z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl py-2 min-w-[200px] animate-scale-in"
                        style={{ left: siteActionMenu.x, top: siteActionMenu.y }}
                    >
                        <button
                            onClick={handleAddNewSite}
                            className="w-full px-4 py-2.5 text-left text-white hover:bg-slate-700 flex items-center gap-3 transition-colors"
                        >
                            <Plus size={18} className="text-green-400" />
                            <div>
                                <div className="font-medium">Add New Site</div>
                                <div className="text-xs text-slate-400">Create a new site</div>
                            </div>
                        </button>
                        <button
                            onClick={handleLinkExistingSites}
                            className="w-full px-4 py-2.5 text-left text-white hover:bg-slate-700 flex items-center gap-3 transition-colors"
                        >
                            <Server size={18} className="text-blue-400" />
                            <div>
                                <div className="font-medium">Link Existing Sites</div>
                                <div className="text-xs text-slate-400">Add sites to this group</div>
                            </div>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default Setting;
