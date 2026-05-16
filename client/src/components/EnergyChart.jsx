import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Legend,
    PieChart,
    Pie,
    Cell
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div style={{ background: '#1e293b', border: '1px solid #334155', padding: '10px', borderRadius: '5px' }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>{label}</p>
                {payload.map((pld, index) => (
                    <p key={index} style={{ margin: 0, color: pld.color }}>
                        {pld.name}: {Number(pld.value).toLocaleString()} kWh
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

export const EnergyAreaChart = ({ data, dataKey = "value", color = "#3b82f6" }) => {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id={`color${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey={dataKey} stroke={color} fillOpacity={1} fill={`url(#color${dataKey})`} />
            </AreaChart>
        </ResponsiveContainer>
    );
};

export const ComparisonBarChart = ({ data, lastLabel = "Last Period", currentLabel = "Current Period" }) => {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} barGap={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Legend
                    wrapperStyle={{ paddingTop: '10px' }}
                    align="center"
                    formatter={(value) => <span style={{ margin: '0 10px' }}>{value}</span>}
                />
                <Bar dataKey="last" name={lastLabel} fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={50} />
                <Bar dataKey="current" name={currentLabel} fill="#fbbf24" radius={[4, 4, 0, 0]} barSize={50} />
            </BarChart>
        </ResponsiveContainer>
    );
};

export const MultiLineChart = ({ data, keys, colors }) => {
    return (
        <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    {keys.map((key, index) => (
                        <linearGradient key={key} id={`color${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={colors[index % colors.length]} stopOpacity={0.1} />
                            <stop offset="95%" stopColor={colors[index % colors.length]} stopOpacity={0} />
                        </linearGradient>
                    ))}
                </defs>
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '10px' }} />
                {keys.map((key, index) => (
                    <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={colors[index % colors.length]}
                        fillOpacity={1}
                        fill={`url(#color${key})`}
                        strokeWidth={2}
                    />
                ))}
            </AreaChart>
        </ResponsiveContainer>
    );
};



export const SimplePieChart = ({ data, colors }) => {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
};
