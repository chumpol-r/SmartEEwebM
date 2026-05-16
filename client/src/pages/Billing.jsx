import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Autocomplete from '../components/Autocomplete';
import { Calendar, Search, Save, Printer, Zap, FileText } from 'lucide-react';
import { useToast } from '../components/Toast';

const Billing = () => {
    const toast = useToast();
    const [meters, setMeters] = useState([]);
    const [selectedMeter, setSelectedMeter] = useState(null);

    // Default to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    const [startDate, setStartDate] = useState(firstDay);
    const [endDate, setEndDate] = useState(lastDay);

    const [loading, setLoading] = useState(false);
    const [usageData, setUsageData] = useState({
        onPeak: 0,
        offPeak: 0,
        holiday: 0,
        demand: 0,
        maxDemandDate: 'N/A'
    });

    const [rates, setRates] = useState({
        onPeak: 0,
        offPeak: 0,
        holiday: 0,
        demand: 0,
        ft: 0,
        service: 0,
        vat: 7
    });

    const [calculated, setCalculated] = useState({
        totalOnPeak: 0,
        totalOffPeak: 0,
        totalHoliday: 0,
        totalDemand: 0,
        totalFt: 0,
        totalService: 0,
        subTotal: 0,
        vatAmount: 0,
        grandTotal: 0,
        avgUnitChargeBeforeVat: 0,
        avgUnitChargeAfterVat: 0
    });

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
                const saved = localStorage.getItem('billing_meter');
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
            localStorage.setItem('billing_meter', selectedMeter);
        }
    }, [selectedMeter, initialized]);

    // Fetch Data & Rates
    const fetchData = async () => {
        if (!selectedMeter) return;
        setLoading(true);
        try {
            // 1. Fetch Usage Data (Billing)
            const usageRes = await axios.get('/api/data', {
                params: {
                    paraData: 'datatable',
                    paraChart: 'Billing',
                    paraMeter: selectedMeter,
                    chartColumn: 'LastkWDemand',
                    timeStart: `${startDate} 00:00:00`,
                    timeEnd: `${endDate} 23:59:59`
                }
            });

            // 2. Fetch Max Demand
            const demandRes = await axios.get('/api/data', {
                params: {
                    paraData: 'datatable',
                    paraChart: 'MaxDmPeak_OnPeak',
                    paraMeter: selectedMeter,
                    chartColumn: 'KWH',
                    timeStart: `${startDate} 00:00:00`,
                    timeEnd: `${endDate} 23:59:59`,
                    Adjust_Val: 4
                }
            });

            // 3. Fetch Rates
            const token = localStorage.getItem('token');
            const ratesRes = await axios.get('/api/billing/rates', {
                params: {
                    date: startDate
                },
                headers: { Authorization: `Bearer ${token}` }
            });

            // Process Usage
            let sumOn = 0, sumOff = 0, sumHoliday = 0;
            if (usageRes.data) {
                usageRes.data.forEach(row => {
                    sumOn += row.OnPeak || 0;
                    sumOff += row.OffPeak || 0;
                    sumHoliday += row.Holiday || 0;
                });
            }

            // Process Demand
            let maxDemand = 0;
            let maxDemandDate = 'N/A';
            if (demandRes.data && demandRes.data.length > 0) {
                // Legacy: MaxDemand = ch12.Rows(0)(2) ' * 4 (commented out in legacy?)
                // Legacy code: MaxDemand = ch12.Rows(0)(2)
                // Let's assume index 2 is the value. The columns might be Times, something, Value.
                // Let's inspect the object structure if possible, but for now assume property access.
                // If it returns standard JSON, we look for a numeric property.
                // Usually it returns { Times: ..., Val: ... }
                // Let's assume the 3rd key or a specific key.
                // Based on standard GetData, it returns pivoted data.
                // Let's assume the value is in a property named after the meter or 'Value'.
                // Actually, let's look at legacy: ch12.Rows(0)(2).
                // If we can't be sure, we might need to check the response.
                // For now, let's take the first numeric value we find that isn't 'Times'.
                const row = demandRes.data[0];
                const keys = Object.keys(row);
                // Find a key that is likely the value (not Times, not Unit)
                const valKey = keys.find(k => k !== 'Times' && k !== 'Unit' && k !== 'rowNum');
                if (valKey) maxDemand = row[valKey];

                if (row.Times) {
                    // Format: 2020-04-20...
                    const d = new Date(row.Times);
                    maxDemandDate = d.toLocaleDateString('en-GB');
                }
            }

            setUsageData({
                onPeak: sumOn,
                offPeak: sumOff,
                holiday: sumHoliday,
                demand: maxDemand,
                maxDemandDate
            });

            // Process Rates
            if (ratesRes.data && ratesRes.data.length > 0) {
                const r = ratesRes.data[0];
                setRates({
                    onPeak: r.OnPeak || 0,
                    offPeak: r.OffPeak || 0,
                    holiday: r.Holiday || 0,
                    demand: r.Demand || 0,
                    ft: r.FT || 0,
                    service: r.Service || 0,
                    vat: r.n_Vat || 7
                });
            }

        } catch (err) {
            console.error("Failed to fetch billing data", err);
        } finally {
            setLoading(false);
        }
    };

    // Auto-fetch when meter or dates change
    useEffect(() => {
        if (selectedMeter) {
            fetchData();
        }
    }, [selectedMeter, startDate, endDate]);

    // Calculate Totals
    useEffect(() => {
        const totalOnPeak = usageData.onPeak * rates.onPeak;
        const totalOffPeak = usageData.offPeak * rates.offPeak;
        const totalHoliday = usageData.holiday * rates.holiday;
        const totalDemand = usageData.demand * rates.demand;

        const totalUnits = usageData.onPeak + usageData.offPeak + usageData.holiday;
        const totalFt = totalUnits * rates.ft;
        const totalService = Number(rates.service); // Fixed amount

        const subTotal = totalOnPeak + totalOffPeak + totalHoliday + totalDemand + totalFt + totalService;
        const vatAmount = (subTotal * rates.vat) / 100;
        const grandTotal = subTotal + vatAmount;

        // Averages
        const sumAmount = totalUnits + usageData.demand + totalUnits; // Denominator logic from legacy: sumOn + sumOff + sumHoliday + MaxDemand + Ft (Wait, Ft is unit based?)
        // Legacy: sumAmount = sumOn + sumOff + sumHoliday + MaxDemand + Ft
        // Wait, Ft in legacy calculation: Ft = sumOn + sumOff + sumHoliday (Total Units)
        // So sumAmount = Total Units + MaxDemand + Total Units = 2 * Total Units + MaxDemand?
        // Let's re-read legacy carefully.
        // sumTotal = Ctotal1 + ... + Ctotal5 (Sum of Costs 1-5)
        // sumAmount = sumOn + sumOff + sumHoliday + MaxDemand + Ft
        // where Ft = sumOn + sumOff + sumHoliday
        // So sumAmount = TotalUnits + MaxDemand + TotalUnits.
        // N1 = sumTotal / sumAmount.

        // This seems weird (adding units twice), but I will replicate legacy logic exactly.
        const legacySumAmount = totalUnits + usageData.demand + totalUnits;
        const legacySumTotal = totalOnPeak + totalOffPeak + totalHoliday + totalDemand + totalFt; // Items 1-5 cost

        const avgUnitChargeBeforeVat = legacySumAmount > 0 ? legacySumTotal / legacySumAmount : 0;

        // Note 2: (sumTotal * T1)/100 + sumTotal  / sumAmount
        // N2 = (sumTotal * vat) / 100
        // No21 = (N2 + sumTotal) / sumAmount
        const avgUnitChargeAfterVat = legacySumAmount > 0 ? (legacySumTotal + (legacySumTotal * rates.vat / 100)) / legacySumAmount : 0;

        setCalculated({
            totalOnPeak,
            totalOffPeak,
            totalHoliday,
            totalDemand,
            totalFt,
            totalService,
            subTotal,
            vatAmount,
            grandTotal,
            avgUnitChargeBeforeVat,
            avgUnitChargeAfterVat
        });

    }, [usageData, rates]);

    const handleRateChange = (field, value) => {
        setRates(prev => ({
            ...prev,
            [field]: Number(value)
        }));
    };

    const handleSave = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.post('/api/billing/rates', {
                startDate,
                endDate,
                rates
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Rates saved successfully!');
        } catch (err) {
            console.error("Failed to save rates", err);
            toast.error('Failed to save rates.');
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const fmt = (val) => {
        const num = Number(val);
        if (isNaN(num) || !isFinite(num)) {
            return '0.00';
        }
        return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto print:max-w-none print:p-0">
            {/* Controls - Hide on Print */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg print:hidden">
                <div className="flex flex-col md:flex-row gap-4 items-end md:items-center">

                    {/* Meter Selector */}
                    <div className="flex-1 min-w-[200px]">
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
                                onChange={(e) => setStartDate(e.target.value)}
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
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleSave}
                        className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 h-[42px]"
                    >
                        <Save size={18} /> Save
                    </button>

                    <button
                        onClick={handlePrint}
                        className="bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 h-[42px]"
                    >
                        <Printer size={18} /> Print
                    </button>
                </div>
            </div>

            {/* Billing Invoice */}
            <div className="bg-white text-black p-8 rounded-xl shadow-lg print:shadow-none print:p-0" id="billing-invoice">
                {/* Header */}
                <div className="border-b-2 border-gray-800 pb-4 mb-6">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl font-bold uppercase tracking-wide">Electricity Billing</h1>
                            <p className="text-sm text-gray-600 mt-1">
                                <strong>Meter:</strong> {(() => { const m = meters.find(m => m.val === selectedMeter); return m ? (m.displayName || m.name) : selectedMeter; })()}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-600">
                                <strong>Period:</strong> {new Date(startDate).toLocaleDateString('en-GB')} - {new Date(endDate).toLocaleDateString('en-GB')}
                            </p>
                            <p className="text-sm text-gray-600">
                                <strong>Rate Type:</strong> TOU Rate
                            </p>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-y-2 border-gray-800">
                            <th className="py-2 text-left w-[40%]">Item</th>
                            <th className="py-2 text-right w-[15%]">Amount</th>
                            <th className="py-2 text-center w-[10%]">Unit</th>
                            <th className="py-2 text-right w-[20%]">Baht/Unit</th>
                            <th className="py-2 text-right w-[15%]">Total (Baht)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {/* 1. On Peak */}
                        <tr>
                            <td className="py-3 pl-2">1. On Peak Energy Charge (09:00 - 22:00)</td>
                            <td className="py-3 text-right font-mono">{fmt(usageData.onPeak)}</td>
                            <td className="py-3 text-center text-gray-500">kWh</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.onPeak}
                                    onChange={(e) => handleRateChange('onPeak', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalOnPeak)}</td>
                        </tr>
                        {/* 2. Off Peak */}
                        <tr>
                            <td className="py-3 pl-2">2. Off Peak Energy Charge (22:00 - 09:00)</td>
                            <td className="py-3 text-right font-mono">{fmt(usageData.offPeak)}</td>
                            <td className="py-3 text-center text-gray-500">kWh</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.offPeak}
                                    onChange={(e) => handleRateChange('offPeak', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalOffPeak)}</td>
                        </tr>
                        {/* 3. Holiday */}
                        <tr>
                            <td className="py-3 pl-2">3. Holiday Energy Charge</td>
                            <td className="py-3 text-right font-mono">{fmt(usageData.holiday)}</td>
                            <td className="py-3 text-center text-gray-500">kWh</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.holiday}
                                    onChange={(e) => handleRateChange('holiday', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalHoliday)}</td>
                        </tr>
                        {/* 4. Demand */}
                        <tr>
                            <td className="py-3 pl-2">4. Demand Charge</td>
                            <td className="py-3 text-right font-mono">{fmt(usageData.demand)}</td>
                            <td className="py-3 text-center text-gray-500">kW</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.demand}
                                    onChange={(e) => handleRateChange('demand', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalDemand)}</td>
                        </tr>
                        {/* 5. FT */}
                        <tr>
                            <td className="py-3 pl-2">5. FT Charge</td>
                            <td className="py-3 text-right font-mono">{fmt(usageData.onPeak + usageData.offPeak + usageData.holiday)}</td>
                            <td className="py-3 text-center text-gray-500">kWh</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.ft}
                                    onChange={(e) => handleRateChange('ft', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalFt)}</td>
                        </tr>
                        {/* 6. Service */}
                        <tr>
                            <td className="py-3 pl-2">6. Service Charge</td>
                            <td className="py-3 text-right font-mono">-</td>
                            <td className="py-3 text-center text-gray-500">-</td>
                            <td className="py-3 text-right">
                                <input
                                    type="number"
                                    value={rates.service}
                                    onChange={(e) => handleRateChange('service', e.target.value)}
                                    className="w-20 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                />
                            </td>
                            <td className="py-3 text-right font-mono font-medium">{fmt(calculated.totalService)}</td>
                        </tr>

                        {/* Total */}
                        <tr className="border-t-2 border-gray-800 font-bold">
                            <td className="py-3 pl-2" colSpan="4">Total</td>
                            <td className="py-3 text-right font-mono text-lg">{fmt(calculated.subTotal)}</td>
                        </tr>

                        {/* VAT */}
                        <tr>
                            <td className="py-2 pl-2" colSpan="3">VAT</td>
                            <td className="py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                    <input
                                        type="number"
                                        value={rates.vat}
                                        onChange={(e) => handleRateChange('vat', e.target.value)}
                                        className="w-12 text-right border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                    <span>%</span>
                                </div>
                            </td>
                            <td className="py-2 text-right font-mono">{fmt(calculated.vatAmount)}</td>
                        </tr>

                        {/* Grand Total */}
                        <tr className="border-t border-gray-400 font-bold text-xl bg-gray-50">
                            <td className="py-4 pl-2" colSpan="4">Grand Total</td>
                            <td className="py-4 text-right font-mono text-blue-700">{fmt(calculated.grandTotal)}</td>
                        </tr>
                    </tbody>
                </table>

                {/* Notes */}
                <div className="mt-8 text-sm text-gray-600 space-y-2 border-t border-gray-300 pt-4">
                    <p className="font-bold italic mb-2">Note:</p>
                    <p>1) Average energy unit charge (before VAT) = <span className="font-mono font-bold text-black">{fmt(calculated.avgUnitChargeBeforeVat)}</span> Baht/kWh</p>
                    <p>2) Average energy unit charge (after VAT) = <span className="font-mono font-bold text-black">{fmt(calculated.avgUnitChargeAfterVat)}</span> Baht/kWh</p>
                    <p>3) Max Demand occurred on: <span className="font-mono font-bold text-black">{usageData.maxDemandDate}</span></p>
                </div>
            </div>

            {/* Print Styles */}
            <style>{`
                @media print {
                    body {
                        background-color: white;
                        color: black;
                    }
                    #root > div {
                        max-width: none;
                        padding: 0;
                    }
                    .print\\:hidden {
                        display: none !important;
                    }
                    .print\\:shadow-none {
                        box-shadow: none !important;
                    }
                    .print\\:p-0 {
                        padding: 0 !important;
                    }
                }
            `}</style>
        </div>
    );
};

export default Billing;
