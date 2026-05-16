import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import axios from 'axios';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const EnergyDistributionNode = ({ data, selected }) => {
    const [chartData, setChartData] = useState([]);
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
            const meterIds = data.meterIds || [];

            if (meterIds.length === 0) {
                setChartData([]);
                return;
            }

            setLoading(true);
            try {
                const timeRange = data.timeRange || 'day';
                const { start, end } = getDateRange(timeRange);

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
                    }).then(res => ({ id, data: res.data }))
                );

                const responses = await Promise.all(promises);

                // Aggregate data by Meter
                const aggregatedData = responses.map(({ id, data: meterData }) => {
                    let totalKwh = 0;
                    if (meterData && meterData.length > 0) {
                        meterData.forEach(item => {
                            totalKwh += (item.Value || 0);
                        });
                    }
                    // Look up meter name from stored meterNames array
                    const meterNamesArray = data.meterNames || [];
                    const meterInfo = meterNamesArray.find(m => m.id === id);
                    const meterName = meterInfo ? meterInfo.name : `Meter ${id}`;

                    return {
                        name: meterName,
                        value: totalKwh
                    };
                });

                setChartData(aggregatedData);
            } catch (err) {
                console.error("Failed to fetch energy distribution data", err);
                setChartData([]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [data.meterIds, data.timeRange]);

    // Styling
    const getStyle = () => {
        const { color = '#3b82f6', gradientDirection = 'TL-BR', gradientPercentage = 50, transparentBackground = false } = data;

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

    // Handle visibility logic
    const handleStyle = { opacity: selected ? 1 : 0, transition: 'opacity 0.2s' };

    // Color Palettes - 10 presets for users to choose
    const COLOR_PALETTES = {
        default: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'],
        ocean: ['#0077b6', '#00b4d8', '#0096c7', '#48cae4', '#90e0ef', '#023e8a', '#0077b6', '#00b4d8', '#0096c7', '#48cae4'],
        sunset: ['#ff6b35', '#f7c59f', '#efa43e', '#e63946', '#ff9f1c', '#d62828', '#fb8500', '#ffb703', '#e07a5f', '#f4a261'],
        forest: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#1b4332', '#2d6a4f', '#40916c', '#52b788', '#74c69d'],
        berry: ['#7400b8', '#6930c3', '#5e60ce', '#5390d9', '#4ea8de', '#48bfe3', '#56cfe1', '#64dfdf', '#72efdd', '#80ffdb'],
        candy: ['#ff0a54', '#ff477e', '#ff5c8a', '#ff7096', '#ff85a1', '#ff99ac', '#fbb1bd', '#f9bec7', '#f7cad0', '#fae0e4'],
        earth: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#606c38', '#283618', '#bc6c25', '#dda15e', '#6b705c'],
        neon: ['#39ff14', '#ff073a', '#00ffff', '#ff00ff', '#ffff00', '#ff6600', '#00ff66', '#6600ff', '#ff0066', '#00ffcc'],
        pastel: ['#a8dadc', '#f1faee', '#e9c46a', '#f4a261', '#e76f51', '#ccd5ae', '#e9edc9', '#fefae0', '#faedcd', '#d4a373'],
        monochrome: ['#212529', '#343a40', '#495057', '#6c757d', '#adb5bd', '#ced4da', '#dee2e6', '#e9ecef', '#f8f9fa', '#495057']
    };

    // Get selected palette or default
    const selectedPalette = COLOR_PALETTES[data.colorPalette] || COLOR_PALETTES.default;

    return (
        <>
            <NodeResizer
                minWidth={200}
                minHeight={150}
                isVisible={selected}
                lineClassName="border-blue-500"
                handleClassName="h-3 w-3 bg-white border-2 border-blue-500 rounded"
            />

            {/* Handles - All Sides - Dynamic Visibility */}
            <Handle type="target" position={Position.Top} id="t" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="source" position={Position.Top} id="t" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="target" position={Position.Right} id="r" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="source" position={Position.Right} id="r" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="target" position={Position.Bottom} id="b" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="source" position={Position.Bottom} id="b" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="target" position={Position.Left} id="l" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />
            <Handle type="source" position={Position.Left} id="l" style={handleStyle} className="w-3 h-3 bg-blue-500 border-2 border-white" />

            <div style={getStyle()}>
                <div className="w-full h-full p-2 flex flex-col">
                    <div className="text-xs font-bold text-slate-700 mb-1 px-2">
                        Energy Distribution ({data.timeRange || 'Day'})
                    </div>
                    <div className="flex-1 w-full min-h-0">
                        {loading ? (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Loading...</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                {data.chartType === 'pie' ? (
                                    <PieChart>
                                        <Pie
                                            data={chartData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={40}
                                            outerRadius={80}
                                            fill="#8884d8"
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {chartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={selectedPalette[index % selectedPalette.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value) => [value.toLocaleString(undefined, { maximumFractionDigits: 2 }), 'kWh']} />
                                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                                    </PieChart>
                                ) : (
                                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                            interval={0}
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
                                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                            {chartData.map((entry, index) => (
                                                <Cell key={`bar-${index}`} fill={selectedPalette[index % selectedPalette.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                )}
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default memo(EnergyDistributionNode);
