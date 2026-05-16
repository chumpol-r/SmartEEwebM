import React, { memo, useState, useEffect, useRef } from 'react';
import { NodeResizer, Handle, Position } from 'reactflow';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import mqtt from 'mqtt';
import { Activity, Wifi, WifiOff } from 'lucide-react';
import { useConfig } from '../../contexts/ConfigContext';

const RealtimeGraphNode = ({ data, selected }) => {
    const { mqttUrl, mqttOptions: configMqttOptions, loading: configLoading } = useConfig();
    const [chartData, setChartData] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [latestValue, setLatestValue] = useState(0);

    // Refs for data management to avoid closure staleness in MQTT callback
    const chartDataRef = useRef([]);
    const latestValuesRef = useRef({}); // Map of serial -> value
    const clientRef = useRef(null);

    // MQTT Options (using config values)
    const MQTT_OPTIONS = {
        ...configMqttOptions,
        clientId: "mqtt_node_" + Math.random().toString(16),
    };

    // Styling
    const {
        color = '#3b82f6',
        lineColor = '#ffffff', // Line color for chart
        gradientDirection = 'TL-BR',
        gradientPercentage = 50,
        timeWindow = 5, // Minutes
        meterIds = [],
        meterSerials = [], // Use serials for MQTT, fallback to meterIds
        dataType = 'KW', // Default to KW
        transparentBackground = false
    } = data;

    // Use meterSerials for MQTT if available, fallback to meterIds for backward compatibility
    const mqttSerials = meterSerials.length > 0 ? meterSerials : meterIds;

    const borderWidth = data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px';
    const borderColor = data.borderColor || color;

    // Gradient Logic
    let cssDir = 'to bottom right';
    if (gradientDirection === 'TR-BL') cssDir = 'to bottom left';
    if (gradientDirection === 'BL-TR') cssDir = 'to top right';
    if (gradientDirection === 'BR-TL') cssDir = 'to top left';
    if (gradientDirection === 'TC-BC') cssDir = 'to bottom';
    if (gradientDirection === 'BC-TC') cssDir = 'to top';

    const containerStyle = {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '6px',
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

    // MQTT Connection
    useEffect(() => {
        if (!mqttSerials || mqttSerials.length === 0) {
            if (clientRef.current) {
                clientRef.current.end();
                clientRef.current = null;
                setIsConnected(false);
            }
            return;
        }

        if (!clientRef.current && !configLoading) {
            console.log("RealtimeGraphNode: Connecting to MQTT at:", mqttUrl);
            const client = mqtt.connect(mqttUrl, MQTT_OPTIONS);
            clientRef.current = client;

            client.on("connect", () => {
                setIsConnected(true);
                // Subscribe using actual serials
                mqttSerials.forEach(serial => {
                    if (serial) {
                        const topic = `SmartEE/Cloud/Device/+/${String(serial).toUpperCase()}`;
                        console.log(`RealtimeGraphNode: Subscribing to ${topic}`);
                        client.subscribe(topic, { qos: 0 });
                    }
                });
            });

            client.on("close", () => setIsConnected(false));
            client.on("offline", () => setIsConnected(false));
            client.on("error", (err) => console.error("MQTT Error", err));

            client.on("message", (topic, message) => {
                try {
                    const payload = message.toString();
                    const cleanPayload = payload.replace(/NaN/g, '0').replace(/Infinity/g, '0');
                    const obj = JSON.parse(cleanPayload);
                    const topicSerial = topic.split("/").pop().toUpperCase();

                    // Check if this serial is in our list (case insensitive)
                    const isRelevant = mqttSerials.some(id => String(id).toUpperCase() === topicSerial);

                    if (isRelevant) {
                        // Use dynamic dataType (KW or KWH)
                        latestValuesRef.current[topicSerial] = obj[dataType] || 0;

                        // Calculate total
                        const total = Object.values(latestValuesRef.current).reduce((a, b) => a + b, 0);
                        setLatestValue(total);

                        // Add to chart
                        const now = Date.now();
                        const newPoint = { time: now, value: total };

                        chartDataRef.current.push(newPoint);

                        // Prune old data
                        const cutoff = now - (timeWindow * 60 * 1000);
                        while (chartDataRef.current.length > 0 && chartDataRef.current[0].time < cutoff) {
                            chartDataRef.current.shift();
                        }

                        // Update state for render
                        setChartData([...chartDataRef.current]);
                    }
                } catch (err) {
                    console.error("Error processing MQTT message", err);
                }
            });
        } else {
            // If already connected, just update subscriptions if needed
        }

        return () => {
            if (clientRef.current) {
                clientRef.current.end();
                clientRef.current = null;
            }
        };
    }, [JSON.stringify(mqttSerials), timeWindow, dataType]); // Re-run if serials, window, or dataType changes

    // Format time for XAxis
    const formatTime = (tick) => {
        const d = new Date(tick);
        return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    };

    // Handle visibility logic
    const handleStyle = { opacity: selected ? 1 : 0, transition: 'opacity 0.2s' };

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

            <div style={containerStyle}>
                {/* Header */}
                <div className="flex justify-between items-center p-2 z-10 bg-black/10 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <Activity size={16} className="text-white" />
                        <span className="text-xs font-bold text-white drop-shadow-md">{data.label || 'Realtime Graph'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-white drop-shadow-md">
                            {latestValue.toFixed(2)} {dataType}
                        </span>
                        {isConnected ? (
                            <Wifi size={12} className="text-green-400" />
                        ) : (
                            <WifiOff size={12} className="text-red-400" />
                        )}
                    </div>
                </div>

                {/* Chart */}
                <div className="flex-1 w-full h-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id={`grad-${data.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="time"
                                domain={['dataMin', 'dataMax']}
                                tickFormatter={formatTime}
                                hide={true}
                            />
                            <YAxis hide={true} domain={['auto', 'auto']} />
                            <Tooltip
                                labelFormatter={formatTime}
                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff', fontSize: '12px' }}
                                itemStyle={{ color: '#fff' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke={lineColor}
                                strokeWidth={2}
                                fill={`url(#grad-${data.id})`}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Footer / Time Window Label */}
                <div className="absolute bottom-1 right-2 z-10">
                    <span className="text-[10px] text-white/70 bg-black/20 px-1 rounded">
                        Last {timeWindow} min
                    </span>
                </div>
            </div>
        </>
    );
};

export default memo(RealtimeGraphNode);
