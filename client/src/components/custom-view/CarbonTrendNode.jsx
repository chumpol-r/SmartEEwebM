import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const CarbonTrendNode = ({ data, selected }) => {
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Gradient handling (similar to Box/CarbonCredit)
    const getStyle = () => {
        const { color = '#10b981', gradientDirection = 'TL-BR', gradientPercentage = 50, transparentBackground = false } = data;

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
            backgroundColor: 'white' // Default background for chart visibility
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

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const timeRange = data.timeRange || 'day';
                const date = data.date || new Date().toISOString().split('T')[0];
                // Using the same API endpoint as CarbonCreditNode but we use the array data for the chart
                const res = await axios.get(`/api/carbon-credit/data?timeRange=${timeRange}&date=${date}`);

                // Transform data for Recharts if necessary
                // Assuming API returns [{ time: '...', emission: ... }, ...]
                setChartData(res.data);
            } catch (err) {
                console.error("Failed to fetch carbon trend data", err);
                setChartData([]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [data.timeRange, data.date]);

    return (
        <>
            <NodeResizer
                minWidth={200}
                minHeight={150}
                isVisible={selected}
                lineClassName="border-blue-500"
                handleClassName="h-3 w-3 bg-white border-2 border-blue-500 rounded"
            />

            <Handle type="target" position={Position.Top} id="t" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Right} id="r" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Bottom} id="b" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Left} id="l" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />

            <div style={getStyle()}>
                {/* nodrag class allows interaction with chart inside */}
                <div className="w-full h-full p-2 flex flex-col">
                    <div className="text-xs font-bold text-slate-700 mb-1 px-2">
                        Carbon Trend ({data.timeRange || 'Day'})
                    </div>
                    <div className="flex-1 w-full min-h-0">
                        {loading ? (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Loading...</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorEmission" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="time"
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="emission"
                                        stroke="#10b981"
                                        fillOpacity={1}
                                        fill="url(#colorEmission)"
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

export default memo(CarbonTrendNode);
