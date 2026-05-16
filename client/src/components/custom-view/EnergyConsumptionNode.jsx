import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const EnergyConsumptionNode = ({ data, selected }) => {
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Helper to calculate start/end dates (Same as Dashboard/Analysis Nodes)
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

    // Helper to generate empty trend data
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

    useEffect(() => {
        const fetchData = async () => {
            const meterIds = data.meterIds || (data.meterId ? [data.meterId] : []);

            if (meterIds.length === 0) {
                setChartData([]);
                return;
            }

            setLoading(true);
            try {
                const timeRange = data.timeRange || 'day';
                const { start, end } = getDateRange(timeRange);

                // Initialize aggregated data structure
                let aggregatedData = generateEmptyTrend(timeRange);

                // Fetch data for ALL meters
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

                // Aggregate data
                responses.forEach(res => {
                    if (res.data && res.data.length > 0) {
                        res.data.forEach(item => {
                            const t = parseInt(item.Times);
                            let index = -1;

                            if (timeRange === 'day') {
                                index = t;
                            } else if (timeRange === 'week') {
                                index = t - 1;
                                if (index < 0) index = 6;
                            } else if (timeRange === 'month') {
                                index = t - 1;
                            } else if (timeRange === 'year') {
                                index = t - 1;
                            }

                            if (index >= 0 && index < aggregatedData.length) {
                                aggregatedData[index].value += (item.Value || 0);
                            }
                        });
                    }
                });

                setChartData(aggregatedData);
            } catch (err) {
                console.error("Failed to fetch energy consumption data", err);
                setChartData([]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [data.meterIds, data.meterId, data.timeRange]);

    // Styling
    const getStyle = () => {
        const { color = '#3b82f6', gradientDirection = 'TL-BR', gradientPercentage = 50, transparentBackground = false } = data; // Blue default

        let cssDir = 'to bottom right';
        if (gradientDirection === 'TR-BL') cssDir = 'to bottom left';
        if (gradientDirection === 'BL-TR') cssDir = 'to top right';
        if (gradientDirection === 'BR-TL') cssDir = 'to top left';
        if (gradientDirection === 'TC-BC') cssDir = 'to bottom';
        if (gradientDirection === 'BC-TC') cssDir = 'to top';

        const baseStyle = {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            borderRadius: '6px',
            position: 'relative',
            overflow: 'hidden',
            borderWidth: data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px',
            borderColor: data.borderColor || color,
            borderStyle: 'solid',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            backgroundColor: 'white'
        };

        // If transparent background is enabled
        if (transparentBackground) {
            return {
                ...baseStyle,
                background: 'transparent',
                backgroundColor: 'transparent'
            };
        }

        if (gradientPercentage === 0) {
            return {
                ...baseStyle,
                backgroundColor: color
            };
        }

        return {
            ...baseStyle,
            background: `linear-gradient(${cssDir}, ${color} 0%, white ${gradientPercentage}%)`
        };
    };

    return (
        <>
            <NodeResizer
                minWidth={200}
                minHeight={150}
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

            <div style={getStyle()}>
                <div className="w-full h-full p-2 flex flex-col">
                    <div className="text-xs font-bold text-slate-700 mb-1 px-2">
                        Energy Consumption ({data.timeRange || 'Day'})
                    </div>
                    <div className="flex-1 w-full min-h-0">
                        {loading ? (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Loading...</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={data.color || '#3b82f6'} stopOpacity={0.8} />
                                            <stop offset="95%" stopColor={data.color || '#3b82f6'} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                        interval="preserveStartEnd"
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                        formatter={(value) => [value.toLocaleString(undefined, { maximumFractionDigits: 2 }), 'kWh']}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="value"
                                        stroke={data.color || '#3b82f6'}
                                        fillOpacity={1}
                                        fill="url(#colorValue)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default memo(EnergyConsumptionNode);
