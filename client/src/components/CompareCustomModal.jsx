import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Download, Calendar, Activity, Loader2, Clock } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

// Utility to generate perfectly spaced 15-min intervals
const generateTimeSlots = () => {
    const slots = [];
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
        }
    }
    // strictly 00:00 - 23:45
    return slots;
};

const CompareCustomModal = ({ isOpen, onClose, selectedMetrics = [], onToggleMetric }) => {
    const [date, setDate] = useState(() => {
        const d = new Date();
        return d.toISOString().split('T')[0];
    });
    const [loading, setLoading] = useState(false);
    const [chartData, setChartData] = useState([]);
    const [viewMode, setViewMode] = useState('chart');
    const [hiddenSeries, setHiddenSeries] = useState({});

    useEffect(() => {
        if (isOpen && selectedMetrics.length === 0) {
            onClose();
        }
    }, [selectedMetrics, isOpen, onClose]);

    useEffect(() => {
        if (!isOpen || selectedMetrics.length === 0) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem('token');
                if (!token) throw new Error("No token found");

                const promises = selectedMetrics.map(async (metric, index) => {
                    // Unique identifier for this data series to avoid collision if same dbKey is picked across meters
                    const dataKey = `m${index}`; 
                    
                    const res = await axios.get('/api/data', {
                        headers: { Authorization: `Bearer ${token}` },
                        params: {
                            paraChart: 'smartCompare',
                            chartColumn: metric.dbKey,
                            chartTime: 'day',
                            paraMeter: metric.meterId,
                            timeStart: `${date} 00:00:00`,
                            timeEnd: `${date} 23:59:59`
                        }
                    });
                    
                    return { metric, dataKey, data: res.data || [] };
                });

                const results = await Promise.all(promises);

                // Initialize merged array
                const baseSlots = generateTimeSlots();
                const mergedMap = {};
                baseSlots.forEach(t => {
                    mergedMap[t] = { time: t };
                });

                results.forEach(({ metric, dataKey, data }) => {
                    data.forEach(row => {
                        // DB returns 'times' natively as DATETIME translated to ISO String "2026-04-08T00:15:00.000Z"
                        if (row.times) {
                            let t = "";
                            if (typeof row.times === 'string' && row.times.includes('T')) {
                                t = row.times.split('T')[1].substring(0, 5); // Extracts HH:mm
                            } else {
                                // Fallback just in case backend was modified to return HH:mm
                                t = String(row.times).substring(0, 5);
                            }

                            if (!mergedMap[t]) {
                                // If t goes out of bounds (like 24:00), ignore it for this strict table
                                return;
                            }
                            mergedMap[t][dataKey] = row.value;
                        }
                    });
                });

                const finalData = Object.values(mergedMap).sort((a, b) => a.time.localeCompare(b.time));
                setChartData(finalData);

            } catch (error) {
                console.error("Failed to fetch custom comparison data", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isOpen, selectedMetrics, date]);

    if (!isOpen) return null;

    // Synchronously compute unique units to avoid Recharts crashes on staggered render cycles
    const uniqueUnits = [...new Set(selectedMetrics.map(m => m.unit || ''))];

    const handleExport = () => {
        // Create CSV lines
        const headers = ['Time', ...selectedMetrics.map(m => `"${m.label} (${m.meterName})"`)].join(',');
        const rows = chartData.map(row => {
            const displayDate = date.split('-').reverse().join('/');
            const cols = [`${displayDate} ${row.time}`];
            selectedMetrics.forEach((m, idx) => {
                const val = row[`m${idx}`];
                cols.push(val !== undefined && val !== null ? val : '');
            });
            return cols.join(',');
        });

        const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `custom_comparison_${date}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Helper to format tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;
        return (
            <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-xl">
                <p className="text-slate-300 font-medium border-b border-slate-700 pb-2 mb-2 items-center flex gap-2">
                    <Clock size={14} /> {label}
                </p>
                {payload.map((entry, index) => {
                    const metric = selectedMetrics.find((_, idx) => `m${idx}` === entry.dataKey);
                    return (
                        <div key={index} className="flex flex-col mb-1.5 last:mb-0">
                            <span className="text-xs text-slate-400 truncate max-w-[200px]" title={metric?.meterName}>
                                {metric?.meterName}
                            </span>
                            <div className="flex items-center justify-between gap-4">
                                <span className="font-medium flex items-center gap-1.5" style={{ color: entry.stroke }}>
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.stroke }}></span>
                                    {metric?.label}
                                </span>
                                <span className="font-mono text-white">
                                    {entry.value !== null ? Number(entry.value).toFixed(2) : '--'} <span className="text-xs text-slate-400">{metric?.unit}</span>
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Generate completely distinct colors
    const getStrokeColor = (metric, index) => {
        const palette = [
            '#3b82f6', // blue
            '#10b981', // emerald
            '#f59e0b', // amber
            '#ef4444', // red
            '#8b5cf6', // violet
            '#ec4899', // pink
            '#06b6d4', // cyan
            '#f97316', // orange
            '#84cc16', // lime
            '#6366f1', // indigo
            '#14b8a6', // teal
            '#f43f5e', // rose
        ];
        return palette[index % palette.length];
    };

    const handleLegendClick = (e) => {
        if (!e.dataKey) return;
        setHiddenSeries(prev => ({
            ...prev,
            [e.dataKey]: !prev[e.dataKey]
        }));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-7xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 sticky top-0 z-10 shrink-0">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Activity className="text-blue-400" />
                        Custom Historical Comparison
                    </h2>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                            <button onClick={() => setViewMode('chart')} className={`px-3 py-1 rounded text-sm font-medium transition-colors ${viewMode === 'chart' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Chart</button>
                            <button onClick={() => setViewMode('table')} className={`px-3 py-1 rounded text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Table</button>
                        </div>
                        <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                            <Calendar size={16} className="text-slate-400" />
                            <input 
                                type="date" 
                                value={date} 
                                onChange={(e) => setDate(e.target.value)}
                                className="bg-transparent text-white text-sm outline-none border-none cursor-pointer [color-scheme:dark]"
                            />
                        </div>
                        <button 
                            onClick={handleExport}
                            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors border border-slate-700"
                        >
                            <Download size={16} /> Export CSV
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-2"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Body Content */}
                <div className="flex-1 p-6 flex flex-col gap-6 min-h-0 overflow-hidden">
                    
                    {/* Selected Metrics Summary */}
                    <div className="flex flex-wrap gap-2">
                        {selectedMetrics.map((m, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 pr-2 pl-3 py-1.5 rounded-lg text-sm group transition-all hover:border-slate-500">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getStrokeColor(m, idx) }}></div>
                                <div className="flex flex-col">
                                    <span className="font-semibold text-white leading-tight">{m.label}</span>
                                    <span className="text-[10px] text-slate-400 leading-tight">{m.meterName}</span>
                                </div>
                                <button 
                                    onClick={() => onToggleMetric && onToggleMetric({ dbKey: m.dbKey, label: m.label, unit: m.unit, color: m.color }, m.serial, m.meterId, m.meterName)}
                                    className="ml-1 p-1 rounded-md hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors"
                                    title="Remove metric"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Chart Container */}
                    {viewMode !== 'table' && (
                        <div className={viewMode === 'chart' ? "bg-slate-800/20 border border-slate-700 rounded-xl p-4 flex-1 relative min-h-[400px]" : "bg-slate-800/20 border border-slate-700 rounded-xl p-4 h-[400px] shrink-0 relative"}>
                            {loading ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 z-10 rounded-xl">
                                    <Loader2 size={32} className="text-blue-500 animate-spin" />
                                </div>
                            ) : null}
                            
                            <div className="absolute inset-0 p-4 pb-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                        <XAxis 
                                            dataKey="time" 
                                            stroke="#94a3b8" 
                                            fontSize={12}
                                            tickLine={false}
                                            tickMargin={10}
                                            minTickGap={30}
                                        />
                                        
                                        {/* Dynamically generate a YAxis for each unique unit */}
                                        {uniqueUnits.map((u, i) => {
                                            const firstMetricIdx = selectedMetrics.findIndex(m => (m.unit || '') === u);
                                            const axisColor = firstMetricIdx >= 0 ? getStrokeColor(selectedMetrics[firstMetricIdx], firstMetricIdx) : '#cbd5e1';
                                            
                                            return (
                                            <YAxis 
                                                key={`yAxis-${u}`} 
                                                yAxisId={u} 
                                                orientation={i % 2 === 0 ? "left" : "right"} 
                                                stroke={axisColor}
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={{ stroke: axisColor, strokeOpacity: 0.5 }}
                                                tickFormatter={(val) => {
                                                    if (val >= 1000000) return `${(val/1000000).toFixed(1)}M ${u}`;
                                                    if (val >= 1000) return `${(val/1000).toFixed(1)}k ${u}`;
                                                    return `${val} ${u}`;
                                                }}
                                                width={80}
                                                domain={['auto', 'auto']}
                                            />
                                        )})}

                                        <RechartsTooltip content={<CustomTooltip />} />
                                        <Legend 
                                            wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }} 
                                            onClick={handleLegendClick}
                                            formatter={(value, entry) => {
                                                const isHidden = hiddenSeries[entry.dataKey];
                                                return <span className={isHidden ? 'text-slate-500 line-through' : 'text-slate-300 font-medium'} style={{ color: isHidden ? '#64748b' : entry.color }}>{value}</span>;
                                            }}
                                        />

                                        {/* Render Lines */}
                                        {selectedMetrics.map((metric, idx) => (
                                            <Line 
                                                key={`m${idx}`}
                                                hide={!!hiddenSeries[`m${idx}`]}
                                                yAxisId={metric.unit || ''}
                                                type="monotone" 
                                                dataKey={`m${idx}`} 
                                                name={`${metric.label} (${metric.meterName})`}
                                                stroke={getStrokeColor(metric, idx)}
                                                strokeWidth={2}
                                                dot={false}
                                                activeDot={{ r: 5, strokeWidth: 0 }}
                                                connectNulls={false}
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Data Table */}
                    {viewMode === 'table' && (
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex-1 flex flex-col min-h-[400px]">
                            <div className="overflow-auto flex-1 relative">
                                <table className="w-full text-sm text-left text-slate-300">
                                    <thead className="text-xs text-slate-400 uppercase bg-slate-900 border-b border-slate-700 sticky top-0 z-10 shadow-sm shadow-black/50">
                                    <tr>
                                        <th className="px-4 py-3 font-medium whitespace-nowrap min-w-[100px] bg-slate-900">Time</th>
                                        {selectedMetrics.map((m, idx) => (
                                            <th key={idx} className="px-4 py-3 font-medium whitespace-nowrap bg-slate-900">
                                                <div className="flex flex-col">
                                                    <span className="text-white flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: getStrokeColor(m, idx) }}></span>
                                                        {m.label} <span className="text-[10px] normal-case font-normal text-slate-500">[{m.unit}]</span>
                                                    </span>
                                                    <span className="font-normal text-slate-500 truncate max-w-[200px] mt-0.5">{m.meterName}</span>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {chartData.map((row, i) => (
                                        <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                                            <td className="px-4 py-2 font-mono text-slate-400">
                                                <span className="text-[10px] opacity-60 mr-2">{date.split('-').reverse().join('/')}</span>
                                                {row.time}
                                            </td>
                                            {selectedMetrics.map((m, idx) => {
                                                const val = row[`m${idx}`];
                                                return (
                                                    <td key={idx} className="px-4 py-2 font-mono text-white">
                                                        {val !== null && val !== undefined ? Number(val).toFixed(2) : '-'}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CompareCustomModal;
