import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Monitor, Plus, Search, Settings, Save, Trash2, X, Printer } from 'lucide-react';
import QRCodeStyling from 'qr-code-styling';
import Autocomplete from '../components/Autocomplete';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';

const Smartboard = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const [boards, setBoards] = useState([]);
    const [meterTypes, setMeterTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [permissions, setPermissions] = useState({ view: false, insert: false, update: false, delete: false, admin: false });
    const [permLoading, setPermLoading] = useState(true);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);

    const [newSerial, setNewSerial] = useState('');
    const [newDescription, setNewDescription] = useState('');

    const [selectedBoard, setSelectedBoard] = useState(null);
    const [configChannels, setConfigChannels] = useState([]);
    const [configDescription, setConfigDescription] = useState('');

    // QR Code for Add Modal
    const qrCodeRef = useRef(null);
    const [qrCode, setQrCode] = useState(null);

    // QR Modal for existing boards
    const [showQrModal, setShowQrModal] = useState(false);
    const [qrSerial, setQrSerial] = useState('');
    const qrModalRef = useRef(null);
    const [qrModalCode, setQrModalCode] = useState(null);
    const [baseUrl, setBaseUrl] = useState('http://localhost:5173'); // Default fallback

    useEffect(() => {
        const init = async () => {
            await checkPermissions(); // Check permissions first
        };
        init();
        fetchMeterTypes();
        fetchConfig();
    }, []);

    const checkPermissions = async () => {
        try {
            const res = await axios.get('/api/user/permissions/39', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            const perms = res.data;
            setPermissions(perms);

            if (!perms.view) {
                navigate('/access-denied');
            } else {
                fetchBoards(); // Only fetch if allowed
            }
        } catch (err) {
            console.error("Failed to check permissions", err);
            navigate('/access-denied');
        } finally {
            setPermLoading(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await axios.get('/api/system/config');
            if (res.data.baseUrl) {
                setBaseUrl(res.data.baseUrl);
            }
        } catch (err) {
            console.error("Failed to fetch system config", err);
        }
    };

    useEffect(() => {
        // Initialize QR Code for Add Modal
        const qr = new QRCodeStyling({
            width: 155,
            height: 155,
            type: "svg",
            data: "https://smarteepro.com",
            image: "/smartee.svg", // Use our new logo
            dotsOptions: {
                color: "#18498d",
                type: "rounded"
            },
            backgroundOptions: {
                color: "#ffffff",
            },
            imageOptions: {
                crossOrigin: "anonymous",
                margin: 5
            }
        });
        setQrCode(qr);

        // Initialize QR Code for View Modal
        const qrModal = new QRCodeStyling({
            width: 200,
            height: 200,
            type: "svg",
            data: "https://smarteepro.com",
            image: "/smartee.svg",
            dotsOptions: { color: "#18498d", type: "rounded" },
            backgroundOptions: { color: "#ffffff" },
            imageOptions: { crossOrigin: "anonymous", margin: 5 }
        });
        setQrModalCode(qrModal);
    }, []);

    useEffect(() => {
        if (qrCode && newSerial && qrCodeRef.current) {
            qrCode.update({
                data: `${baseUrl}/scan?serial=${newSerial}`
            });
            qrCodeRef.current.innerHTML = '';
            qrCode.append(qrCodeRef.current);
        }
    }, [qrCode, newSerial, showAddModal]);

    useEffect(() => {
        if (showQrModal && qrSerial && qrModalCode && qrModalRef.current) {
            qrModalCode.update({
                data: `${baseUrl}/scan?serial=${qrSerial}`
            });
            qrModalRef.current.innerHTML = '';
            qrModalCode.append(qrModalRef.current);
        }
    }, [showQrModal, qrSerial, qrModalCode]);

    const fetchBoards = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            console.log('=== DEBUG fetchBoards ===');
            console.log('Token exists:', !!token);
            console.log('Token (first 30 chars):', token ? token.substring(0, 30) + '...' : 'NULL');

            const res = await axios.get('/api/smartboards', {
                params: { search: searchTerm },
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Smartboards response:', res.data?.length, 'items');
            setBoards(res.data);
        } catch (err) {
            console.error("Failed to fetch boards", err);
            console.error("Error status:", err.response?.status);
            console.error("Error data:", err.response?.data);
        } finally {
            setLoading(false);
        }
    };

    const fetchMeterTypes = async () => {
        try {
            const res = await axios.get('/api/meter-types');
            // Map id to val for Autocomplete
            const mapped = res.data.map(m => ({ val: String(m.id).trim(), name: m.name, disabled: m.disabled }));
            setMeterTypes(mapped);
        } catch (err) {
            console.error("Failed to fetch meter types", err);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        fetchBoards();
    };

    const handleAddBoard = async () => {
        if (!newSerial) return;
        try {
            await axios.post('/api/smartboards', {
                serial: newSerial,
                description: newDescription
            }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setShowAddModal(false);
            setNewSerial('');
            setNewDescription('');
            fetchBoards();
        } catch (err) {
            console.error(err);
            toast.error('Failed to add board');
        }
    };

    const handleDeleteBoard = async (id) => {
        const confirmed = await toast.confirm(`Are you sure you want to delete board ${id}?`, {
            title: 'Delete Board',
            type: 'error',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        try {
            const res = await axios.delete(`/api/smartboards/${id}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.data.success) {
                toast.success('Board deleted successfully!');
            }
            fetchBoards();
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.message || 'Failed to delete board');
        }
    };

    const handleConfigClick = async (boardId) => {
        setSelectedBoard(boardId);
        try {
            // Get board details to find description (from the list since API /:id only returns channels)
            const boardInfo = boards.find(b => b.boardid === boardId);
            setConfigDescription(boardInfo ? boardInfo.description : '');

            const res = await axios.get(`/api/smartboards/${boardId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            const data = res.data;

            // Determine existing channel count - at least 8, max 20
            let maxChannel = 8;
            if (data && data.length > 0) {
                data.forEach(d => {
                    // Extract channel number from boardid (last 2 digits)
                    const chNum = parseInt(d.boardid.slice(-2), 10);
                    if (!isNaN(chNum) && chNum > maxChannel) {
                        maxChannel = chNum;
                    }
                });
            }
            maxChannel = Math.min(maxChannel, 20); // Cap at 20

            // Initialize channels
            const channels = [];
            for (let i = 1; i <= maxChannel; i++) {
                const idStr = String(i).padStart(2, '0');
                // Find existing config for this channel. Note: DB strings might have trailing spaces so we trim.
                const match = data.find(d => String(d.boardid).trim().endsWith(idStr));

                channels.push({
                    id: idStr,
                    enable: match ? String(match.active).trim() === 'Y' : false,
                    command: match ? String(match.command || 'Meter').trim() : 'Meter',
                    type: match ? String(match.mtype || '').trim() : '',
                    address: match ? String(match.address || i).trim() : i,
                    name: match ? String(match.channelName || '').trim() : ''
                });
            }
            setConfigChannels(channels);
            setShowConfigModal(true);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load board config');
        }
    };

    const handleAddChannel = () => {
        if (configChannels.length >= 20) {
            toast.warning('Maximum 20 channels allowed');
            return;
        }
        const newId = String(configChannels.length + 1).padStart(2, '0');
        setConfigChannels([...configChannels, {
            id: newId,
            enable: false,
            command: 'Meter',
            type: '',
            address: configChannels.length + 1,
            name: ''
        }]);
    };

    const handleRemoveChannel = (index) => {
        if (configChannels.length <= 1) {
            toast.warning('At least 1 channel is required');
            return;
        }
        const newChannels = configChannels.filter((_, i) => i !== index);
        // Re-number channels
        const renumbered = newChannels.map((ch, i) => ({
            ...ch,
            id: String(i + 1).padStart(2, '0'),
            address: ch.address // Keep original address
        }));
        setConfigChannels(renumbered);
    };

    const handleSaveConfig = async () => {
        try {
            await axios.put(`/api/smartboards/${selectedBoard}`, {
                channels: configChannels,
                description: configDescription
            }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setShowConfigModal(false);
            fetchBoards();
        } catch (err) {
            console.error(err);
            toast.error(`Failed to save config: ${err.response?.data || err.message}`);
        }
    };

    const updateChannel = (index, field, value) => {
        const newChannels = [...configChannels];
        newChannels[index][field] = value;

        // If enabling, force command to 'Meter'
        if (field === 'enable' && value === true) {
            newChannels[index]['command'] = 'Meter';
        }

        setConfigChannels(newChannels);
    };

    const handlePrint = () => {
        const printWindow = window.open('', '', 'width=600,height=600');
        printWindow.document.write('<html><head><title>Print QR Code</title>');
        printWindow.document.write('<style>body{font-family: Arial, sans-serif; text-align: center; padding-top: 50px;}</style>');
        printWindow.document.write('</head><body>');
        printWindow.document.write(`<h2>Serial: ${newSerial}</h2>`);
        printWindow.document.write(qrCodeRef.current.innerHTML);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    };

    const handleShowQr = (serial) => {
        setQrSerial(serial);
        setShowQrModal(true);
    };

    const handlePrintModal = () => {
        const printWindow = window.open('', '', 'width=600,height=600');
        printWindow.document.write('<html><head><title>Print QR Code</title>');
        printWindow.document.write('<style>body{font-family: Arial, sans-serif; text-align: center; padding-top: 50px;}</style>');
        printWindow.document.write('</head><body>');
        printWindow.document.write(`<h2>Serial: ${qrSerial}</h2>`);
        printWindow.document.write(qrModalRef.current.innerHTML);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    };

    if (permLoading) return <div className="p-8 text-white text-center">Checking permissions...</div>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Monitor className="text-blue-400" /> Smartboard Management
                </h1>
                {permissions.insert && (
                    <button
                        onClick={() => { setShowAddModal(true); setNewSerial(''); setNewDescription(''); }}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                    >
                        <Plus size={18} /> Add New Board
                    </button>
                )}
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 text-slate-500" size={20} />
                    <input
                        type="text"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                        placeholder="Search Serial Number..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button type="submit" className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg">
                    Search
                </button>
            </form>

            {/* Board List */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-900 text-slate-400 uppercase font-medium">
                        <tr>
                            <th className="px-6 py-4">Serial Number</th>
                            <th className="px-6 py-4">Description</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Applied</th>
                            <th className="px-6 py-4">Installed</th>
                            <th className="px-6 py-4">Create Date</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {loading ? (
                            <tr><td colSpan="7" className="px-6 py-8 text-center">Loading...</td></tr>
                        ) : boards.length === 0 ? (
                            <tr><td colSpan="7" className="px-6 py-8 text-center">No boards found.</td></tr>
                        ) : (
                            boards.map((board) => (
                                <tr key={board.boardid} className="hover:bg-slate-700/50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-white">{board.boardid}</td>
                                    <td className="px-6 py-4">{board.description}</td>
                                    <td className="px-6 py-4">{board.active}</td>
                                    <td className="px-6 py-4">{board.command}</td>
                                    <td className="px-6 py-4">{board.mtype}</td>
                                    <td className="px-6 py-4">{board.dateon}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button
                                            onClick={() => handleShowQr(board.boardid)}
                                            className="text-purple-400 hover:text-purple-300 p-1"
                                            title="Print QR Code"
                                        >
                                            <Printer size={18} />
                                        </button>
                                        {permissions.update && (
                                            <button
                                                onClick={() => handleConfigClick(board.boardid)}
                                                className="text-blue-400 hover:text-blue-300 p-1"
                                                title="Configure"
                                            >
                                                <Settings size={18} />
                                            </button>
                                        )}
                                        {permissions.delete && (
                                            <button
                                                onClick={() => handleDeleteBoard(board.boardid)}
                                                className="text-red-400 hover:text-red-300 p-1"
                                                title="Delete"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-white mb-4">Add New Smartboard</h2>

                        <div className="flex flex-col items-center mb-6">
                            <div className="bg-white p-2 rounded-lg mb-4" ref={qrCodeRef}></div>
                            <div className="flex gap-2 w-full mb-3">
                                <input
                                    type="text"
                                    className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
                                    placeholder="Enter Serial Number"
                                    value={newSerial}
                                    onChange={(e) => setNewSerial(e.target.value)}
                                    maxLength={15}
                                />
                                <button
                                    onClick={handlePrint}
                                    className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg"
                                    title="Print QR Code"
                                    disabled={!newSerial}
                                >
                                    <Printer size={20} />
                                </button>
                            </div>
                            <div className="w-full">
                                <input
                                    type="text"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
                                    placeholder="Description (Optional)"
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                            <button onClick={handleAddBoard} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg">Add Board</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Config Modal */}
            {showConfigModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-5xl p-6 max-h-[90vh] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white">Configure Board: {selectedBoard}</h2>
                            <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm text-slate-400 mb-1">Description</label>
                            <input
                                type="text"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
                                value={configDescription}
                                onChange={(e) => setConfigDescription(e.target.value)}
                                placeholder="Enter board description"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 mb-6 border border-slate-700 rounded-lg bg-slate-900/50">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-900 text-slate-400 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-2 w-16">CH</th>
                                        <th className="px-4 py-2 w-24">Enable</th>
                                        <th className="px-4 py-2 w-64">Meter Type</th>
                                        <th className="px-4 py-2 w-24">Address</th>
                                        <th className="px-4 py-2 w-48">Name</th>
                                        <th className="px-4 py-2 w-16"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700">
                                    {configChannels.map((ch, index) => (
                                        <tr key={index} className={!ch.enable ? 'opacity-50' : ''}>
                                            <td className="px-4 py-2 text-slate-400">{ch.id}</td>
                                            <td className="px-4 py-2">
                                                <select
                                                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white"
                                                    value={ch.enable ? 'Y' : 'N'}
                                                    onChange={(e) => updateChannel(index, 'enable', e.target.value === 'Y')}
                                                >
                                                    <option value="N">Disable</option>
                                                    <option value="Y">Enable</option>
                                                </select>
                                            </td>
                                            <td className="px-4 py-2">
                                                {/* Hidden Command Input (Always 'Meter' if enabled) */}
                                                <input type="hidden" value={ch.command} />

                                                {/* Autocomplete for Meter Type */}
                                                <div className={!ch.enable ? 'pointer-events-none opacity-50' : ''}>
                                                    <Autocomplete
                                                        items={meterTypes}
                                                        selected={ch.type}
                                                        onChange={(val) => updateChannel(index, 'type', val)}
                                                        placeholder="Select Type"
                                                        multiple={false}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    disabled={!ch.enable}
                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white disabled:opacity-50"
                                                    value={ch.address}
                                                    onChange={(e) => updateChannel(index, 'address', e.target.value)}
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="text"
                                                    disabled={!ch.enable}
                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white disabled:opacity-50"
                                                    value={ch.name || ''}
                                                    onChange={(e) => updateChannel(index, 'name', e.target.value)}
                                                    placeholder="Channel name"
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <button
                                                    onClick={() => handleRemoveChannel(index)}
                                                    className="text-slate-500 hover:text-red-400 p-1"
                                                    title="Remove Channel"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Add Channel Button */}
                            <div className="p-3 border-t border-slate-700 flex items-center justify-between">
                                <button
                                    onClick={handleAddChannel}
                                    disabled={configChannels.length >= 20}
                                    className="flex items-center gap-2 text-blue-400 hover:text-blue-300 disabled:text-slate-600 disabled:cursor-not-allowed"
                                >
                                    <Plus size={18} />
                                    Add Channel
                                </button>
                                <span className="text-sm text-slate-500">
                                    {configChannels.length} / 20 channels
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                            <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                            <button onClick={handleSaveConfig} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                                <Save size={18} /> Save Config
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QR View Modal */}
            {showQrModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-sm p-6 text-center">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white">QR Code</h2>
                            <button onClick={() => setShowQrModal(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="bg-white p-4 rounded-lg mb-4 inline-block" ref={qrModalRef}></div>

                        <h3 className="text-lg font-medium text-white mb-6">{qrSerial}</h3>

                        <div className="flex justify-center gap-3">
                            <button onClick={handlePrintModal} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg flex items-center gap-2">
                                <Printer size={20} /> Print
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Smartboard;
