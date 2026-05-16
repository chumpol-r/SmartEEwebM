import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Autocomplete from '../components/Autocomplete';
import { MultiLineChart, SimplePieChart } from '../components/EnergyChart';
import { Calendar, Search, BarChart2, PieChart as PieIcon, TrendingUp, Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#d946ef'];

const Comparison = () => {
    const [meters, setMeters] = useState([]);
    const [selectedMeters, setSelectedMeters] = useState([]); // Array of IDs

    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [timeFrame, setTimeFrame] = useState('day'); // day, week, month, year
    const [trendData, setTrendData] = useState([]);
    const [totalData, setTotalData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [initialized, setInitialized] = useState(false);

    // Fetch Meters
    useEffect(() => {
        const fetchMeters = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('/api/meters', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setMeters(res.data);

                // Load from localStorage or default
                const saved = localStorage.getItem('comparison_meters');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        // Map saved IDs to actual values to ensure type consistency
                        const validMeters = parsed.map(id => {
                            const found = res.data.find(m => String(m.val) === String(id));
                            return found ? found.val : null;
                        }).filter(val => val !== null);

                        if (validMeters.length > 0) {
                            setSelectedMeters(validMeters);
                        } else if (res.data.length >= 2) {
                            setSelectedMeters([res.data[0].val, res.data[1].val]);
                        } else if (res.data.length > 0) {
                            setSelectedMeters([res.data[0].val]);
                        }
                    } catch (e) {
                        console.error("Failed to parse saved meters", e);
                        // Fallback logic
                        if (res.data.length >= 2) {
                            setSelectedMeters([res.data[0].val, res.data[1].val]);
                        } else if (res.data.length > 0) {
                            setSelectedMeters([res.data[0].val]);
                        }
                    }
                } else if (res.data.length >= 2) {
                    setSelectedMeters([res.data[0].val, res.data[1].val]);
                } else if (res.data.length > 0) {
                    setSelectedMeters([res.data[0].val]);
                }
            } catch (err) {
                console.error("Failed to fetch meters", err);
            } finally {
                setInitialized(true);
            }
        };
        fetchMeters();
    }, []);

    // Persist selection
    useEffect(() => {
        if (initialized) {
            localStorage.setItem('comparison_meters', JSON.stringify(selectedMeters));
        }
    }, [selectedMeters, initialized]);

    // Helper to get date range
    const getDateRange = (baseDate, frame) => {
        // Parse date as local time (prevents UTC interpretation of YYYY-MM-DD)
        const [year, month, day] = baseDate.split('-').map(Number);
        const d = new Date(year, month - 1, day); // month is 0-indexed
        let start, end;

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
        const fmt = (dt, time) => {
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const d = String(dt.getDate()).padStart(2, '0');
            return `${y}-${m}-${d} ${time}`;
        };

        return {
            start: fmt(start, '00:00:00'),
            end: fmt(end, '23:59:59')
        };
    };

    // Fetch Data
    useEffect(() => {
        if (selectedMeters.length === 0) {
            setTrendData([]);
            setTotalData([]);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            try {
                const { start, end } = getDateRange(date, timeFrame);

                // 1. Trend Data (Line Chart)
                // Using CompareMeter chart type which returns pivoted data (Times, Meter1, Meter2...)
                const trendRes = await axios.get('/api/data', {
                    params: {
                        paraData: 'datatable',
                        paraChart: 'CompareMeter',
                        paraMeter: selectedMeters.join(','),
                        chartColumn: 'KWH',
                        chartTime: timeFrame,
                        timeStart: start,
                        timeEnd: end
                    }
                });

                // Create a map of serial -> displayName for the selected meters FIRST
                const serialToDisplayName = {};
                selectedMeters.forEach(id => {
                    const m = meters.find(m => m.val === id);
                    // The API key might be the serial (stripped from Domain\serial format)
                    let serialKey = m ? (m.serial || m.val) : id;
                    if (typeof serialKey === 'string' && serialKey.includes('\\')) {
                        serialKey = serialKey.split('\\').pop();
                    }
                    const displayName = m ? (m.displayName || m.name) : id;
                    serialToDisplayName[serialKey.toUpperCase()] = displayName;
                    serialToDisplayName[String(id).toUpperCase()] = displayName;
                    // Also map by name (legacy)
                    if (m && m.name) {
                        serialToDisplayName[m.name.toUpperCase()] = displayName;
                    }
                    // Also map by meter ID (val) - this is what the new API returns
                    serialToDisplayName[String(id)] = displayName;
                });

                console.log('[Comparison] serialToDisplayName:', serialToDisplayName);

                // Process Trend Data - map serial keys to displayName
                const rawTrend = trendRes.data || [];
                console.log('[Comparison] rawTrend sample:', rawTrend.slice(0, 2));
                const processedTrend = rawTrend.map(row => {
                    let label = row.Times;
                    if (timeFrame === 'day') {
                        label = `${String(row.Times).padStart(2, '0')}:00`;
                    }

                    // Create new row with displayName keys instead of serial keys
                    const newRow = { label, Times: row.Times };
                    Object.keys(row).forEach(key => {
                        if (key !== 'Times' && key !== 'label' && key !== 'Unit') {
                            const displayName = serialToDisplayName[key.toUpperCase()] || key;
                            newRow[displayName] = row[key];
                        }
                    });
                    return newRow;
                });
                setTrendData(processedTrend);

                // 2. Total Data (Pie & Bar)
                const displayNameTotals = {};
                selectedMeters.forEach(id => {
                    const m = meters.find(m => m.val === id);
                    const displayName = m ? (m.displayName || m.name) : id;
                    displayNameTotals[displayName] = 0;
                });

                // Sum up values from processedTrend
                // The keys in processedTrend are now the displayNames
                if (processedTrend.length > 0) {
                    processedTrend.forEach(row => {
                        Object.keys(row).forEach(key => {
                            if (key !== 'Times' && key !== 'label' && key !== 'Unit') {
                                // Try to find the displayName for this key
                                const displayName = serialToDisplayName[key.toUpperCase()] || key;
                                if (!displayNameTotals[displayName]) {
                                    displayNameTotals[displayName] = 0;
                                }
                                displayNameTotals[displayName] += Number(row[key] || 0);
                            }
                        });
                    });
                }

                const totalArray = Object.keys(displayNameTotals).map(name => ({
                    name: name,
                    value: displayNameTotals[name]
                }));

                setTotalData(totalArray);

            } catch (err) {
                console.error("Failed to fetch comparison data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [selectedMeters, date, timeFrame, meters]);

    // Get keys for MultiLineChart (Meter Names)
    const getChartKeys = () => {
        if (totalData.length > 0) {
            return totalData.map(d => d.name);
        }
        return [];
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Controls */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <div className="flex flex-col xl:flex-row gap-6 items-start xl:items-center justify-between">

                    {/* Meter Selection */}
                    <div className="w-full xl:max-w-md">
                        <label className="text-slate-400 text-sm mb-2 block">Select Meters (2-16)</label>
                        <div className="flex items-start gap-2">
                            <Zap size={20} className="text-yellow-400 mt-2" />
                            <div className="flex-1">
                                <Autocomplete
                                    items={meters}
                                    selected={selectedMeters}
                                    onChange={setSelectedMeters}
                                    placeholder="Select meters to compare..."
                                    multiple={true}
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Selected: {selectedMeters.length} meters
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Date & Timeframe */}
                    <div className="flex flex-col sm:flex-row gap-4 w-full xl:w-auto">
                        <div>
                            <label className="text-slate-400 text-sm mb-2 block">Date</label>
                            <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2">
                                <Calendar size={18} className="text-blue-400" />
                                <input
                                    type="date"
                                    className="bg-transparent text-white focus:outline-none text-sm"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    lang="en-GB"
                                    style={{ colorScheme: 'dark' }}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-slate-400 text-sm mb-2 block">Period</label>
                            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-600">
                                {['day', 'week', 'month', 'year'].map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => setTimeFrame(t)}
                                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${timeFrame === t
                                            ? 'bg-blue-600 text-white shadow-lg'
                                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                            }`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Total Comparison (Bar) */}
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <BarChart2 size={20} className="text-blue-400" />
                        Total Consumption (kWh)
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={totalData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                />
                                <Bar dataKey="value" name="Energy (kWh)" radius={[4, 4, 0, 0]}>
                                    {totalData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Distribution (Pie) */}
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <PieIcon size={20} className="text-purple-400" />
                        Energy Distribution
                    </h3>
                    <div className="h-[300px]">
                        <SimplePieChart data={totalData} colors={COLORS} />
                    </div>
                </div>

                {/* Trend Analysis (Line) */}
                <div className="col-span-1 lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <TrendingUp size={20} className="text-green-400" />
                        Trend Analysis
                    </h3>
                    <div className="h-[400px]">
                        <MultiLineChart
                            data={trendData}
                            keys={getChartKeys()}
                            colors={COLORS}
                        />
                    </div>
                </div>

            </div>

            {selectedMeters.length < 2 && (
                <div className="text-center text-slate-500 py-8">
                    Please select at least 2 meters to compare.
                </div>
            )}
        </div>
    );
};

export default Comparison;
