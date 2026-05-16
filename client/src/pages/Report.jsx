import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Autocomplete from '../components/Autocomplete';
import { Calendar, Search, FileText, Download, Zap } from 'lucide-react';

const Report = () => {
    const [meters, setMeters] = useState([]);
    const [selectedMeter, setSelectedMeter] = useState(null);
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const [expandedGroup, setExpandedGroup] = useState(null); // 'volt', 'amp', or null

    const toggleGroup = (group) => {
        setExpandedGroup(prev => prev === group ? null : group);
    };

    // Fetch Meters on Load
    useEffect(() => {
        const fetchMeters = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('/api/meters', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setMeters(res.data);

                // Load from localStorage or default
                const saved = localStorage.getItem('report_meter');
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

    // Persist selection
    useEffect(() => {
        if (initialized && selectedMeter) {
            localStorage.setItem('report_meter', selectedMeter);
        }
    }, [selectedMeter, initialized]);

    const fetchReport = async () => {
        if (!selectedMeter) return;
        setLoading(true);
        setHasSearched(true);
        try {
            // 1. Main Data
            const mainRes = await axios.get('/api/data', {
                params: {
                    paraData: 'datatable',
                    paraChart: 'Report',
                    paraMeter: selectedMeter,
                    chartColumn: 'KW,[KWH-unit],KWH,VoltL1,VoltL2,VoltL3,[VoltL-avr],Amp1,Amp2,Amp3,[Amp-avr],PF',
                    chartTime: '',
                    timeStart: `${startDate} 00:00:00`,
                    timeEnd: `${endDate} 23:59:59`
                }
            });

            // 2. Demand Data (for kW-Demand column, mirroring legacy logic)
            const demandRes = await axios.get('/api/data', {
                params: {
                    paraData: 'datatable',
                    paraChart: 'Report',
                    paraMeter: selectedMeter,
                    chartColumn: 'KWH',
                    chartTime: '',
                    timeStart: `${startDate} 00:00:00`,
                    timeEnd: `${endDate} 23:59:59`
                }
            });

            // Process and Merge Data
            const mainData = mainRes.data || [];
            const demandData = demandRes.data || [];

            // Remove first row if it's metadata (Legacy code does dt.Rows.RemoveAt(0))
            // We'll check if the first row looks like metadata or if we should just trust the array
            // The legacy code explicitly removes index 0. Let's try to replicate that safely.
            // If the array is empty, do nothing.

            const processedData = mainData.slice(1).map((row, index) => {
                // Demand data logic: dtDemand.Rows(i)("KWH") where i starts at 1 (since loop matches main data)
                // Since we sliced mainData by 1, the index 0 of processedData corresponds to index 1 of mainData.
                // demandData should also be accessed with an offset if it has the same structure.
                // Assuming demandData also has the metadata row 0.

                const demandRow = demandData[index + 1]; // +1 because we skipped row 0
                const kwDemand = demandRow ? demandRow.KWH : 0;

                return {
                    ...row,
                    kwDemand: kwDemand
                };
            });

            setReportData(processedData);

        } catch (err) {
            console.error("Failed to fetch report data", err);
            setReportData([]);
        } finally {
            setLoading(false);
        }
    };

    // Helper to format numbers
    const fmt = (val) => {
        if (val === null || val === undefined) return '0.00';
        return Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Auto-fetch when filters change
    useEffect(() => {
        if (selectedMeter) {
            fetchReport();
        }
    }, [selectedMeter, startDate, endDate]);

    const handleStartDateChange = (e) => {
        const newStart = e.target.value;
        setStartDate(newStart);
        if (newStart > endDate) {
            setEndDate(newStart);
        }
    };

    const handleEndDateChange = (e) => {
        const newEnd = e.target.value;
        if (newEnd < startDate) {
            // Prevent selecting end date before start date
            // Or we could update start date, but user asked "start date cannot be selected more than end date"
            // Let's just update state, the min attribute will handle UI constraint
            setEndDate(newEnd);
            setStartDate(newEnd);
        } else {
            setEndDate(newEnd);
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header & Controls */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <div className="flex flex-col md:flex-row gap-4 items-end md:items-center">

                    {/* Meter Selector */}
                    <div className="w-full md:max-w-xs">
                        <label className="text-slate-400 text-sm mb-1 block">Meter</label>
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
                    </div>

                    {/* Start Date */}
                    <div>
                        <label className="text-slate-400 text-sm mb-1 block">Start Date</label>
                        <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2">
                            <Calendar size={18} className="text-blue-400" />
                            <input
                                type="date"
                                className="bg-transparent text-white focus:outline-none text-sm"
                                value={startDate}
                                max={endDate}
                                onChange={handleStartDateChange}
                            />
                        </div>
                    </div>

                    {/* End Date */}
                    <div>
                        <label className="text-slate-400 text-sm mb-1 block">End Date</label>
                        <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2">
                            <Calendar size={18} className="text-blue-400" />
                            <input
                                type="date"
                                className="bg-transparent text-white focus:outline-none text-sm"
                                value={endDate}
                                min={startDate}
                                onChange={handleEndDateChange}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText size={20} className="text-blue-400" />
                        Report Data
                    </h3>
                    {reportData.length > 0 && (
                        <button className="text-slate-400 hover:text-white text-sm flex items-center gap-1">
                            <Download size={16} /> Export CSV
                        </button>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-900 text-slate-400 font-medium uppercase">
                            <tr>
                                <th className="px-4 py-3 whitespace-nowrap">Time</th>
                                <th className="px-4 py-3 whitespace-nowrap text-right">kW-Demand</th>
                                <th className="px-4 py-3 whitespace-nowrap text-right">kW</th>
                                <th className="px-4 py-3 whitespace-nowrap text-right">kWh</th>

                                {/* Volt Group */}
                                <th
                                    className="px-4 py-3 whitespace-nowrap text-right cursor-pointer hover:text-white hover:bg-slate-800 transition-colors select-none"
                                    onClick={() => toggleGroup('volt')}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Volt-Avg {expandedGroup === 'volt' ? '[-]' : '[+]'}
                                    </div>
                                </th>
                                {expandedGroup === 'volt' && (
                                    <>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Volt-R</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Volt-S</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Volt-T</th>
                                    </>
                                )}

                                {/* Amp Group */}
                                <th
                                    className="px-4 py-3 whitespace-nowrap text-right cursor-pointer hover:text-white hover:bg-slate-800 transition-colors select-none"
                                    onClick={() => toggleGroup('amp')}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Amp-Avg {expandedGroup === 'amp' ? '[-]' : '[+]'}
                                    </div>
                                </th>
                                {expandedGroup === 'amp' && (
                                    <>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Amp-R</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Amp-S</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-right bg-slate-800/50">Amp-T</th>
                                    </>
                                )}

                                <th className="px-4 py-3 whitespace-nowrap text-right">PF</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {reportData.length > 0 ? (
                                reportData.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-700/50 transition-colors">
                                        <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{row.Times}</td>
                                        <td className="px-4 py-3 text-right text-yellow-400 font-mono">{fmt(row.kwDemand)}</td>
                                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{fmt(row.KW)}</td>
                                        <td className="px-4 py-3 text-right text-blue-400 font-mono">{fmt(row.KWH)}</td>

                                        {/* Volt Data */}
                                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{fmt(row['VoltL-avr'])}</td>
                                        {expandedGroup === 'volt' && (
                                            <>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.VoltL1)}</td>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.VoltL2)}</td>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.VoltL3)}</td>
                                            </>
                                        )}

                                        {/* Amp Data */}
                                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{fmt(row['Amp-avr'])}</td>
                                        {expandedGroup === 'amp' && (
                                            <>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.Amp1)}</td>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.Amp2)}</td>
                                                <td className="px-4 py-3 text-right text-slate-400 font-mono bg-slate-800/30">{fmt(row.Amp3)}</td>
                                            </>
                                        )}

                                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{fmt(row.PF)}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={expandedGroup ? 10 : 7} className="px-4 py-8 text-center text-slate-500">
                                        {hasSearched ? 'No data found for the selected period.' : 'Select a meter and date range to load data.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Report;
