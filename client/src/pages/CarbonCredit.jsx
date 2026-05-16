import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings, Calendar, Leaf, Zap, Info } from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';
import { Dialog } from '@headlessui/react';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';

const CarbonCredit = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const [timeRange, setTimeRange] = useState('day'); // day, week, month, year
    const [data, setData] = useState([]);
    const [config, setConfig] = useState({ meters: [], emissionFactor: 0.5 });
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [availableMeters, setAvailableMeters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [permissions, setPermissions] = useState({ view: false, insert: false, update: false, delete: false, admin: false });
    const [permLoading, setPermLoading] = useState(true);

    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [searchTerm, setSearchTerm] = useState('');

    // Fetch Config and Meters on Load
    useEffect(() => {
        const init = async () => {
            await checkPermissions();
        }
        init();
    }, []);

    const checkPermissions = async () => {
        try {
            const res = await axios.get('/api/user/permissions/40', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            const perms = res.data;
            setPermissions(perms);

            if (!perms.view) {
                navigate('/access-denied');
            } else {
                fetchConfig();
                fetchMeters();
            }
        } catch (err) {
            console.error("Failed to check permissions", err);
            navigate('/access-denied');
        } finally {
            setPermLoading(false);
        }
    };

    // Fetch Data when Time Range or Date changes
    useEffect(() => {
        fetchData();
    }, [timeRange, config.meters, selectedDate]);

    const fetchConfig = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/carbon-credit/config', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setConfig(res.data);
        } catch (err) {
            console.error("Failed to fetch config", err);
        }
    };

    const fetchMeters = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/meters', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setAvailableMeters(res.data);
        } catch (err) {
            console.error("Failed to fetch meters", err);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`/api/carbon-credit/data?timeRange=${timeRange}&date=${selectedDate}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setData(res.data);
        } catch (err) {
            console.error("Failed to fetch data", err);
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.post('/api/carbon-credit/config', config, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setIsConfigOpen(false);
            fetchData(); // Refresh data with new config
            toast.success('Configuration saved!');
        } catch (err) {
            console.error("Failed to save config", err);
            toast.error('Failed to save configuration.');
        }
    };

    const toggleMeter = (meterId) => {
        setConfig(prev => {
            const newMeters = prev.meters.includes(meterId)
                ? prev.meters.filter(id => id !== meterId)
                : [...prev.meters, meterId];
            return { ...prev, meters: newMeters };
        });
    };

    // Calculate Totals
    const totalCarbon = data.reduce((sum, item) => sum + item.carbon, 0);
    const totalEnergy = data.reduce((sum, item) => sum + item.energy, 0);

    if (permLoading) return <div className="p-8 text-white text-center">Checking permissions...</div>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Leaf className="text-green-500" /> Carbon Credit Dashboard
                    </h1>
                    <p className="text-slate-400 text-sm">Monitor your carbon footprint and energy consumption.</p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500 cursor-pointer"
                        style={{ colorScheme: 'dark' }}
                    />
                    <div className="bg-slate-900 rounded-lg p-1 flex border border-slate-700">
                        {['day', 'week', 'month', 'year'].map((range) => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${timeRange === range
                                    ? 'bg-green-600 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                            >
                                {range.charAt(0).toUpperCase() + range.slice(1)}
                            </button>
                        ))}
                    </div>
                    {permissions.update && (
                        <button
                            onClick={() => setIsConfigOpen(true)}
                            className="bg-slate-900 hover:bg-slate-800 text-slate-300 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-2 transition-colors"
                        >
                            <Settings size={18} /> Configure
                        </button>
                    )}
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Leaf size={100} />
                    </div>
                    <h3 className="text-slate-400 text-sm font-medium mb-1">Total Carbon Emission</h3>
                    <div className="text-3xl font-bold text-white">
                        {totalCarbon.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-slate-500 font-normal">kgCO2e</span>
                    </div>
                    <div className="mt-4 text-xs text-slate-500 flex items-center gap-1">
                        <Info size={12} /> Based on factor: {config.emissionFactor} kgCO2e/kWh
                    </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Zap size={100} />
                    </div>
                    <h3 className="text-slate-400 text-sm font-medium mb-1">Total Energy Consumed</h3>
                    <div className="text-3xl font-bold text-white">
                        {totalEnergy.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-slate-500 font-normal">kWh</span>
                    </div>
                    <div className="mt-4 text-xs text-slate-500">
                        From {config.meters.length} selected meters
                    </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Calendar size={100} />
                    </div>
                    <h3 className="text-slate-400 text-sm font-medium mb-1">Current View</h3>
                    <div className="text-3xl font-bold text-white capitalize">
                        {timeRange}
                    </div>
                    <div className="mt-4 text-xs text-slate-500">
                        Data aggregation period
                    </div>
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-6">Carbon Emission Trend</h3>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorCarbon" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value} kg`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(value) => [`${value.toFixed(2)} kgCO2e`, 'Carbon']}
                                />
                                <Area type="monotone" dataKey="carbon" stroke="#22c55e" strokeWidth={3} fillOpacity={1} fill="url(#colorCarbon)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-6">Energy Consumption</h3>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value} kWh`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(value) => [`${value.toFixed(2)} kWh`, 'Energy']}
                                />
                                <Bar dataKey="energy" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Configuration Modal */}
            <Dialog open={isConfigOpen} onClose={() => setIsConfigOpen(false)} className="relative z-50">
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
                <div className="fixed inset-0 flex items-center justify-center p-4">
                    <Dialog.Panel className="w-full max-w-2xl bg-slate-800 rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                            <Dialog.Title className="text-xl font-bold text-white">Configuration</Dialog.Title>
                            <button onClick={() => setIsConfigOpen(false)} className="text-slate-400 hover:text-white">
                                <Settings size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Emission Factor */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Emission Factor (kgCO2e / kWh)
                                </label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    value={config.emissionFactor}
                                    onChange={(e) => setConfig({ ...config, emissionFactor: parseFloat(e.target.value) })}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Standard factor used to convert Energy (kWh) to Carbon Emissions.
                                </p>
                            </div>

                            {/* Meter Selection */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Select Meters for Calculation
                                </label>

                                {/* Search Input */}
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        placeholder="Search meters..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                    />
                                </div>

                                <div className="bg-slate-900 border border-slate-600 rounded-lg p-4 max-h-60 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {availableMeters
                                        .filter(meter => (meter.displayName || meter.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
                                        .map(meter => (
                                            <label key={meter.val} className="flex items-center gap-3 p-2 rounded hover:bg-slate-800 cursor-pointer transition-colors">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.meters.includes(meter.val)
                                                    ? 'bg-green-600 border-green-600'
                                                    : 'border-slate-500'
                                                    }`}>
                                                    {config.meters.includes(meter.val) && <Zap size={12} className="text-white" />}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="hidden"
                                                    checked={config.meters.includes(meter.val)}
                                                    onChange={() => toggleMeter(meter.val)}
                                                />
                                                <span className="text-sm text-slate-300">{meter.displayName || meter.name}</span>
                                            </label>
                                        ))}
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Selected: {config.meters.length} meters
                                </p>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-700 bg-slate-800/50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsConfigOpen(false)}
                                className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveConfig}
                                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium shadow-lg shadow-green-900/20 transition-all"
                            >
                                Save Configuration
                            </button>
                        </div>
                    </Dialog.Panel>
                </div>
            </Dialog>
        </div>
    );
};

export default CarbonCredit;
