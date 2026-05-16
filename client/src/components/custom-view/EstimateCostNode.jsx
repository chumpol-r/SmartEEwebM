import React, { memo, useState, useEffect } from 'react';
import { NodeResizer, Handle, Position } from 'reactflow';
import axios from 'axios';
import { DollarSign } from 'lucide-react';

const EstimateCostNode = ({ data, selected }) => {
    const [value, setValue] = useState(0);
    const [prevValue, setPrevValue] = useState(null);
    const [loading, setLoading] = useState(false);

    // Helper to calculate start/end dates
    const getDateRange = (frame) => {
        const d = new Date();
        let start, end;

        if (frame === 'day') {
            start = new Date(d);
            end = new Date(d);
        } else if (frame === 'week') {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
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

    useEffect(() => {
        const fetchData = async () => {
            const meterIds = data.meterIds || (data.meterId ? [data.meterId] : []);

            if (meterIds.length === 0) {
                setValue(0);
                return;
            }

            setLoading(true);
            try {
                const timeRange = data.timeRange || 'day';
                const { start, end } = getDateRange(timeRange);

                const promises = meterIds.map(id =>
                    axios.get('/api/data', {
                        params: {
                            paraData: 'datatable',
                            paraChart: 'estimatemax',
                            paraMeter: id,
                            chartColumn: 'kWh',
                            chartTime: timeRange,
                            timeStart: start,
                            timeEnd: end
                        }
                    })
                );

                const responses = await Promise.all(promises);

                let grandTotal = 0;
                responses.forEach(res => {
                    if (res.data && res.data.length > 0) {
                        const total = res.data.reduce((acc, curr) => acc + (curr.Value || 0), 0);
                        // Cost Calculation: Total kWh * 4.5 (Hardcoded rate)
                        grandTotal += (total * 4.5);
                    }
                });

                setValue(grandTotal);

                // Fetch Previous Period Data if Comparison Enabled
                if (data.showComparison) {
                    // Calculate previous range
                    const d = new Date();
                    let prevStart, prevEnd;

                    if (timeRange === 'day') d.setDate(d.getDate() - 1);
                    if (timeRange === 'week') d.setDate(d.getDate() - 7);
                    if (timeRange === 'month') d.setMonth(d.getMonth() - 1);
                    if (timeRange === 'year') d.setFullYear(d.getFullYear() - 1);

                    const formatDate = (date, time) => {
                        const yyyy = date.getFullYear();
                        const mm = String(date.getMonth() + 1).padStart(2, '0');
                        const dd = String(date.getDate()).padStart(2, '0');
                        return `${yyyy}-${mm}-${dd} ${time}`;
                    };

                    if (timeRange === 'day') {
                        prevStart = new Date(d);
                        prevEnd = new Date(d);
                    } else if (timeRange === 'week') {
                        const day = d.getDay();
                        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                        prevStart = new Date(d.setDate(diff));
                        prevEnd = new Date(prevStart);
                        prevEnd.setDate(prevStart.getDate() + 6);
                    } else if (timeRange === 'month') {
                        prevStart = new Date(d.getFullYear(), d.getMonth(), 1);
                        prevEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                    } else if (timeRange === 'year') {
                        prevStart = new Date(d.getFullYear(), 0, 1);
                        prevEnd = new Date(d.getFullYear(), 11, 31);
                    }

                    const pStart = formatDate(prevStart, '00:00:00');
                    const pEnd = formatDate(prevEnd, '23:59:59');

                    const prevPromises = meterIds.map(id =>
                        axios.get('/api/data', {
                            params: {
                                paraData: 'datatable',
                                paraChart: 'estimatemax',
                                paraMeter: id,
                                chartColumn: 'kWh',
                                chartTime: timeRange,
                                timeStart: pStart,
                                timeEnd: pEnd
                            }
                        })
                    );

                    const prevResponses = await Promise.all(prevPromises);
                    let prevGrandTotal = 0;
                    prevResponses.forEach(res => {
                        if (res.data && res.data.length > 0) {
                            const total = res.data.reduce((acc, curr) => acc + (curr.Value || 0), 0);
                            prevGrandTotal += (total * 4.5);
                        }
                    });

                    setPrevValue(prevGrandTotal);
                } else {
                    setPrevValue(null);
                }

            } catch (err) {
                console.error("Failed to fetch cost data", err);
                setValue(0);
                setPrevValue(null);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [data.meterIds, data.meterId, data.timeRange, data.showComparison]);

    // Styling
    const { color = '#10b981', gradientDirection = 'TL-BR', gradientPercentage = 50, transparentBackground = false } = data; // Green default
    const borderWidth = data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px';
    const borderColor = data.borderColor || color;

    let cssDir = 'to bottom right';
    if (gradientDirection === 'TR-BL') cssDir = 'to bottom left';
    if (gradientDirection === 'BL-TR') cssDir = 'to top right';
    if (gradientDirection === 'BR-TL') cssDir = 'to top left';
    if (gradientDirection === 'TC-BC') cssDir = 'to bottom';
    if (gradientDirection === 'BC-TC') cssDir = 'to top';

    const style = {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: '6px',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 'bold',
        position: 'relative',
        overflow: 'hidden',
        borderWidth: borderWidth,
        borderColor: borderColor,
        borderStyle: 'solid',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        background: transparentBackground
            ? 'transparent'
            : (gradientPercentage === 0
                ? color
                : `linear-gradient(${cssDir}, ${color} 0%, white ${gradientPercentage}%)`)
    };

    return (
        <>
            <NodeResizer
                minWidth={100}
                minHeight={50}
                isVisible={selected}
                lineClassName="border-blue-500"
                handleClassName="h-3 w-3 bg-white border-2 border-blue-500 rounded"
            />
            {/* Top Handles */}
            <Handle type="target" position={Position.Top} id="t" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />
            <Handle type="source" position={Position.Top} id="t" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />

            {/* Right Handles */}
            <Handle type="target" position={Position.Right} id="r" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />
            <Handle type="source" position={Position.Right} id="r" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />

            {/* Bottom Handles */}
            <Handle type="target" position={Position.Bottom} id="b" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />
            <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />

            {/* Left Handles */}
            <Handle type="target" position={Position.Left} id="l" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />
            <Handle type="source" position={Position.Left} id="l" style={{ opacity: selected ? 1 : 0, transition: 'opacity 0.2s' }} className="w-3 h-3 bg-blue-500" />
            <div style={style}>
                <div className="flex flex-col items-center gap-1 z-10 p-2 text-center">
                    <DollarSign size={24} className="text-white/90" />
                    <div className="text-lg font-bold drop-shadow-md text-slate-800">
                        {loading ? '...' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    {data.showComparison && prevValue !== null && (
                        <div className={`text-[10px] font-bold flex items-center gap-0.5 drop-shadow-sm ${value > prevValue ? 'text-red-600' : 'text-emerald-600'}`}>
                            {value > prevValue ? '▲' : '▼'}
                            {Math.abs(((value - prevValue) / (prevValue || 1)) * 100).toFixed(1)}%
                        </div>
                    )}
                    <div className="text-[10px] opacity-80 uppercase tracking-wider text-slate-700">
                        Estimate Cost ({data.timeRange || 'Day'})
                    </div>
                </div>
            </div>
        </>
    );
};

export default memo(EstimateCostNode);
