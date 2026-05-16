import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { EnergyAreaChart, ComparisonBarChart } from '../components/EnergyChart';
import Autocomplete from '../components/Autocomplete';
import { Calendar, Zap, TrendingUp, DollarSign, Settings, X, Save } from 'lucide-react';
import { useToast } from '../components/Toast';

const Dashboard = () => {
    const toast = useToast();
    const datePickerRef = useRef(null);
    const [meters, setMeters] = useState([]);
    const [selectedMeter, setSelectedMeter] = useState(null); // Single ID
    const [timeFrame, setTimeFrame] = useState('day'); // day, week, month, year
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [loading, setLoading] = useState(false);

    // Data States
    const [energyData, setEnergyData] = useState([]);
    const [comparisonData, setComparisonData] = useState([]);
    const [totalKwh, setTotalKwh] = useState(0);
    const [peakDemand, setPeakDemand] = useState(0);
    const [cost, setCost] = useState(0);
    const [initialized, setInitialized] = useState(false);

    // Dashboard Config States
    const [costRate, setCostRate] = useState(4.5);
    const [currency, setCurrency] = useState('THB');
    const [showSettings, setShowSettings] = useState(false);
    const [tempCostRate, setTempCostRate] = useState(4.5);
    const [tempCurrency, setTempCurrency] = useState('THB');

    const currencies = [
        { code: 'THB', symbol: '฿', name: 'Thai Baht' },
        { code: 'USD', symbol: '$', name: 'US Dollar' },
        { code: 'VND', symbol: '₫', name: 'Vietnamese Dong' },
        { code: 'EUR', symbol: '€', name: 'Euro' },
        { code: 'JPY', symbol: '¥', name: 'Japanese Yen' }
    ];

    // Fetch Meters on Load
    useEffect(() => {
        const fetchMeters = async () => {
            try {
                const token = localStorage.getItem('token');

                // === FETCH DEBUG INFO FIRST ===
                try {
                    const debugRes = await axios.get('/api/meters/debug', {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    console.log('=== PERMISSION DEBUG INFO ===');
                    console.log('User c_id:', debugRes.data.user?.c_id);
                    console.log('User email:', debugRes.data.user?.email);
                    console.log('WebMainSub Level 1 (sub_ids):', debugRes.data.webMainSub?.level1?.map(r => r.sub_id));
                    console.log('WebMainSub Level 2 (sub_ids):', debugRes.data.webMainSub?.level2?.map(r => r.sub_id));
                    console.log('Sample meter vals:', debugRes.data.meters?.first5Vals);
                    console.log('Full debug data:', debugRes.data);
                    console.log('==============================');
                } catch (debugErr) {
                    console.log('Debug endpoint error:', debugErr.message);
                }

                const res = await axios.get('/api/meters', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                // === DEBUG LOG ===
                console.log('=== Meters API Debug ===');
                console.log('Total meters received:', res.data.length);
                if (res.data.length > 0) {
                    console.log('Sample meter:', res.data[0]);
                    console.log('All meter vals:', res.data.map(m => m.val));
                }
                console.log('========================');

                setMeters(res.data);

                // Load from localStorage or default
                const saved = localStorage.getItem('dashboard_meter');
                // Use String() comparison to handle potential number/string mismatch
                const found = saved ? res.data.find(m => String(m.val) === String(saved)) : null;

                if (found) {
                    setSelectedMeter(found.val);
                } else if (res.data.length > 0) {
                    setSelectedMeter(res.data[0].val);
                }
            } catch (err) {
                console.error("Failed to fetch meters", err);
            } finally {
                setInitialized(true);
            }
        };
        fetchMeters();
    }, []);

    // Fetch Dashboard Config on Load
    useEffect(() => {
        const fetchDashboardConfig = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('/api/dashboard/config', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setCostRate(res.data.costRate || 4.5);
                setCurrency(res.data.currency || 'THB');
                setTempCostRate(res.data.costRate || 4.5);
                setTempCurrency(res.data.currency || 'THB');
            } catch (err) {
                console.error("Failed to fetch dashboard config", err);
            }
        };
        fetchDashboardConfig();
    }, []);

    // Save Dashboard Config
    const saveDashboardConfig = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.put('/api/dashboard/config',
                { costRate: tempCostRate, currency: tempCurrency },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setCostRate(tempCostRate);
            setCurrency(tempCurrency);
            setShowSettings(false);
            toast.success('Settings saved successfully!');
        } catch (err) {
            console.error("Failed to save dashboard config", err);
            toast.error('Failed to save settings');
        }
    };

    // Persist selection
    useEffect(() => {
        if (initialized && selectedMeter) {
            localStorage.setItem('dashboard_meter', selectedMeter);
        }
    }, [selectedMeter, initialized]);

    // Helper to calculate start/end dates based on timeframe
    const getDateRange = (baseDate, frame, isPrevious = false) => {
        // Parse date as local time (adding T00:00:00 prevents UTC interpretation of YYYY-MM-DD)
        const [year, month, day] = baseDate.split('-').map(Number);
        const d = new Date(year, month - 1, day); // month is 0-indexed
        let start, end;

        if (isPrevious) {
            if (frame === 'day') d.setDate(d.getDate() - 1);
            if (frame === 'week') d.setDate(d.getDate() - 7);
            if (frame === 'month') d.setMonth(d.getMonth() - 1);
            if (frame === 'year') d.setFullYear(d.getFullYear() - 1);
        }

        if (frame === 'day') {
            start = new Date(d);
            end = new Date(d);
        } else if (frame === 'week') {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
            start = new Date(d.setDate(diff));
            end = new Date(start);
            end.setDate(start.getDate() + 6);
        } else if (frame === 'month') {
            start = new Date(d.getFullYear(), d.getMonth(), 1);
            end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        } else if (frame === 'year') {
            start = new Date(d.getFullYear(), 0, 1);
            end = new Date(d.getFullYear(), 11, 31);
        }

        // Format to YYYY-MM-DD HH:mm:ss
        const formatDate = (date, time) => {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd} ${time}`;
        };

        return {
            start: formatDate(start, '00:00:00'),
            end: formatDate(end, '23:59:59')
        };
    };

    // Helper to generate empty trend data for the full range (to ensure chart looks good)
    const generateEmptyTrend = (frame) => {
        const data = [];
        if (frame === 'day') {
            for (let i = 0; i < 24; i++) data.push({ label: `${String(i).padStart(2, '0')}:00`, value: 0 });
        } else if (frame === 'week') {
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            days.forEach(d => data.push({ label: d, value: 0 }));
        } else if (frame === 'month') {
            for (let i = 1; i <= 31; i++) data.push({ label: `${i}`, value: 0 });
        } else if (frame === 'year') {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            months.forEach(m => data.push({ label: m, value: 0 }));
        }
        return data;
    };

    // Fetch Data when filters change
    useEffect(() => {
        if (!selectedMeter) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const currentRange = getDateRange(date, timeFrame, false);
                const prevRange = getDateRange(date, timeFrame, true);

                // DEBUG LOG
                console.log('[Dashboard] date:', date, 'timeFrame:', timeFrame);
                console.log('[Dashboard] currentRange:', currentRange);
                console.log('[Dashboard] selectedMeter:', selectedMeter);

                // 1. Current Period Data
                const currentRes = await axios.get('/api/data', {
                    params: {
                        paraData: 'datatable',
                        paraChart: 'estimatemax',
                        paraMeter: selectedMeter, // Single ID
                        chartColumn: 'kWh',
                        chartTime: timeFrame,
                        timeStart: currentRange.start,
                        timeEnd: currentRange.end
                    }
                });

                // 2. Previous Period Data (for comparison)
                const prevRes = await axios.get('/api/data', {
                    params: {
                        paraData: 'datatable',
                        paraChart: 'estimatemax',
                        paraMeter: selectedMeter, // Single ID
                        chartColumn: 'kWh',
                        chartTime: timeFrame,
                        timeStart: prevRange.start,
                        timeEnd: prevRange.end
                    }
                });

                // Process Trend Data
                let trendData = generateEmptyTrend(timeFrame);

                console.log('[Dashboard] API response:', currentRes.data?.slice(0, 3));

                if (currentRes.data && currentRes.data.length > 0) {
                    // Get the start date of the current range for offset calculation
                    const rangeStart = new Date(currentRange.start.split(' ')[0]);

                    currentRes.data.forEach(item => {
                        // times is a datetime string like "2026-01-13T07:00:00.000Z"
                        // Extract hour for 'day' timeframe
                        let index = -1;
                        const itemDate = new Date(item.times);

                        if (timeFrame === 'day') {
                            // Parse datetime to get hour
                            index = itemDate.getHours();
                        } else if (timeFrame === 'week') {
                            // Calculate day offset from week start (0-6)
                            const daysDiff = Math.floor((itemDate - rangeStart) / (1000 * 60 * 60 * 24));
                            index = daysDiff;
                        } else if (timeFrame === 'month') {
                            // Use day of month (1-31) -> index 0-30
                            index = itemDate.getDate() - 1;
                        } else if (timeFrame === 'year') {
                            // Use month (0-11) -> index 0-11
                            index = itemDate.getMonth();
                        }

                        if (index >= 0 && index < trendData.length) {
                            // API returns 'value' (lowercase), not 'Value'
                            trendData[index].value = (trendData[index].value || 0) + (item.value || 0);
                        }
                    });
                }

                console.log('[Dashboard] Processed trendData:', trendData.slice(0, 5));

                setEnergyData(trendData);

                // Calculate Totals
                const currentTotal = trendData.reduce((acc, curr) => acc + (curr.value || 0), 0);
                const prevTotal = prevRes.data ? prevRes.data.reduce((acc, curr) => acc + (curr.value || 0), 0) : 0;

                setTotalKwh(currentTotal);
                setPeakDemand(Math.max(...trendData.map(d => d.value || 0)));
                setCost(currentTotal * costRate);

                // Comparison Data
                setComparisonData([
                    {
                        label: 'Energy (kWh)',
                        current: currentTotal,
                        last: prevTotal
                    }
                ]);

            } catch (err) {
                console.error("Failed to fetch data", err);
                // Fallback Mock Data
                setEnergyData([
                    { label: '00:00', value: 120 }, { label: '04:00', value: 132 },
                    { label: '08:00', value: 450 }, { label: '12:00', value: 890 },
                    { label: '16:00', value: 760 }, { label: '20:00', value: 340 },
                ]);
                setComparisonData([
                    { label: 'Energy (kWh)', last: 4000, current: 2400 },
                ]);
                setTotalKwh(1234.56);
                setPeakDemand(890);
                setCost(5432.10);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [selectedMeter, timeFrame, date, costRate]);

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Controls */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap gap-4 items-center shadow-lg">
                <div className="flex items-center gap-2">
                    <Zap size={20} className="text-yellow-400" />
                    <Autocomplete
                        items={meters}
                        selected={selectedMeter}
                        onChange={setSelectedMeter}
                        placeholder="Select meter..."
                        multiple={false}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Calendar size={20} className="text-blue-400" />
                    <input
                        type="date"
                        lang="en-GB" // Hint browser to use DD/MM/YYYY format
                        className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        style={{ colorScheme: 'dark' }}
                    />
                </div>

                <div className="ml-auto flex gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
                    {['day', 'week', 'month', 'year'].map(t => (
                        <button
                            key={t}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${timeFrame === t
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`}
                            onClick={() => setTimeFrame(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden">
                    <div className="text-slate-400 text-sm flex items-center gap-2 mb-2">
                        <Zap size={16} /> Total Consumption
                    </div>
                    <div className="text-3xl font-bold text-white bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
                        {totalKwh.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-slate-500">kWh</span>
                    </div>
                    {comparisonData.length > 0 && (
                        <div className={`text-xs mt-2 flex items-center gap-1 ${comparisonData[0].current > comparisonData[0].last ? 'text-red-400' : 'text-emerald-400'}`}>
                            {comparisonData[0].current > comparisonData[0].last ? '▲' : '▼'}
                            {Math.abs(((comparisonData[0].current - comparisonData[0].last) / (comparisonData[0].last || 1)) * 100).toFixed(1)}%
                            <span className="text-slate-500 ml-1">vs last {timeFrame}</span>
                        </div>
                    )}
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden">
                    <div className="text-slate-400 text-sm flex items-center gap-2 mb-2">
                        <TrendingUp size={16} /> Peak Demand
                    </div>
                    <div className="text-3xl font-bold text-yellow-400">
                        {peakDemand.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-slate-500">kW</span>
                    </div>
                    {/* Note: Peak Demand comparison might need separate data if not available in comparisonData, assuming similar logic or placeholder for now if data missing */}
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden">
                    <div className="text-slate-400 text-sm flex items-center gap-2 mb-2">
                        <DollarSign size={16} /> Estimated Cost
                        <button
                            onClick={() => { setTempCostRate(costRate); setTempCurrency(currency); setShowSettings(true); }}
                            className="ml-auto text-slate-500 hover:text-blue-400 transition-colors"
                            title="Configure Cost Settings"
                        >
                            <Settings size={16} />
                        </button>
                    </div>
                    <div className="text-3xl font-bold text-green-400">
                        {cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-slate-500">{currency}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                        Rate: {costRate} {currency}/kWh
                    </div>
                    {comparisonData.length > 0 && (
                        <div className={`text-xs mt-2 flex items-center gap-1 ${comparisonData[0].current > comparisonData[0].last ? 'text-red-400' : 'text-emerald-400'}`}>
                            {comparisonData[0].current > comparisonData[0].last ? '▲' : '▼'}
                            {Math.abs(((comparisonData[0].current - comparisonData[0].last) / (comparisonData[0].last || 1)) * 100).toFixed(1)}%
                            <span className="text-slate-500 ml-1">vs last {timeFrame}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4">Energy Consumption Trend</h3>
                    <EnergyAreaChart data={energyData} />
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4">Period Comparison</h3>
                    <ComparisonBarChart
                        data={comparisonData}
                        lastLabel={`Last ${timeFrame.charAt(0).toUpperCase() + timeFrame.slice(1)}`}
                        currentLabel={`Current ${timeFrame.charAt(0).toUpperCase() + timeFrame.slice(1)}`}
                    />
                </div>
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white">Cost Settings</h2>
                            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-2">Cost Rate (per kWh)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={tempCostRate}
                                    onChange={(e) => setTempCostRate(parseFloat(e.target.value) || 0)}
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-2">Currency</label>
                                <select
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={tempCurrency}
                                    onChange={(e) => setTempCurrency(e.target.value)}
                                >
                                    {currencies.map(c => (
                                        <option key={c.code} value={c.code}>{c.symbol} {c.code} - {c.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
                            <button
                                onClick={() => setShowSettings(false)}
                                className="px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveDashboardConfig}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                            >
                                <Save size={18} /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
