import React, { memo, useEffect, useState } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import { Zap, Activity, Power, Wifi, WifiOff } from 'lucide-react';
import { useMQTT } from '../../contexts/MQTTContext';

const MeterNode = ({ data, selected, id }) => {
    const [value, setValue] = useState(0);
    const { isConnected, subscribe, unsubscribe, getData } = useMQTT();

    // data contains: label, meterId, serial (for MQTT), type (kW, kWh, Volt, Status, kVAR, Amp, Pf), etc.
    // Note: serial is the meter serial number for MQTT subscription
    // meterId is the database ID (kept for backward compatibility)

    // Use serial for MQTT, fallback to meterId for old saved views
    const mqttSerial = data.serial || data.meterId;

    // Debug log for serial
    console.log(`MeterNode ${id}: serial=${mqttSerial}, isConnected=${isConnected}`);

    // Subscribe to serial on mount and when connected, unsubscribe on unmount
    useEffect(() => {
        if (mqttSerial && isConnected) {
            console.log(`MeterNode ${id}: Subscribing to ${mqttSerial}`);
            subscribe(mqttSerial);
        } else {
            console.log(`MeterNode ${id}: Skip subscribe - serial=${mqttSerial}, connected=${isConnected}`);
        }
        return () => {
            if (mqttSerial) {
                unsubscribe(mqttSerial);
            }
        };
    }, [mqttSerial, isConnected, subscribe, unsubscribe, id]);

    // Get data and update value when MQTT data changes
    const mqttData = getData(mqttSerial);
    console.log(`MeterNode ${id}: mqttData=`, mqttData);

    useEffect(() => {
        if (!mqttData) return;

        // Map type to value based on MQTT data fields
        switch (data.type) {
            case 'kW': setValue(mqttData.KW || 0); break;
            case 'kWh': setValue(mqttData.KWH || 0); break;
            case 'Volt':
                const avgVolt = ((mqttData.VoltL1 || 0) + (mqttData.VoltL2 || 0) + (mqttData.VoltL3 || 0)) / 3;
                setValue(avgVolt);
                break;
            case 'kVAR': setValue(mqttData.KVAR || 0); break;
            case 'Amp':
                const avgAmp = ((mqttData.Amp1 || 0) + (mqttData.Amp2 || 0) + (mqttData.Amp3 || 0)) / 3;
                setValue(avgAmp);
                break;
            case 'Pf': setValue(mqttData.PF || 0); break;
            default: setValue(mqttData.KW || 0);
        }
    }, [mqttData, data.type]);

    const getIcon = () => {
        switch (data.type) {
            case 'kW': return <Zap size={16} />;
            case 'kWh': return <Activity size={16} />;
            case 'Volt': return <Power size={16} />;
            case 'kVAR': return <Zap size={16} className="text-orange-500" />;
            case 'Amp': return <Activity size={16} className="text-blue-500" />;
            case 'Pf': return <Activity size={16} className="text-green-500" />;
            default: return <Zap size={16} />;
        }
    };

    const getGradientStyle = () => {
        const { color = '#18498d', gradientDirection = 'TL-BR', gradientPercentage = 50, transparentBackground = false } = data;

        const borderWidth = data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px';
        const borderColor = data.borderColor || color;

        // If transparent background is enabled
        if (transparentBackground) {
            return {
                background: 'transparent',
                borderWidth: borderWidth,
                borderColor: borderColor,
                borderStyle: 'solid'
            };
        }

        let cssDir = 'to bottom right';
        if (gradientDirection === 'TR-BL') cssDir = 'to bottom left';
        if (gradientDirection === 'BL-TR') cssDir = 'to top right';
        if (gradientDirection === 'BR-TL') cssDir = 'to top left';
        if (gradientDirection === 'TC-BC') cssDir = 'to bottom';
        if (gradientDirection === 'BC-TC') cssDir = 'to top';

        return {
            background: `linear-gradient(${cssDir}, ${color} 0%, white ${gradientPercentage}%)`,
            borderWidth: borderWidth,
            borderColor: borderColor,
            borderStyle: 'solid'
        };
    };

    const handleStyle = { opacity: selected ? 1 : 0, transition: 'opacity 0.2s' };
    const { showLabel = true, showIcon = true, showStatus = true } = data;
    const hasData = !!mqttData;

    return (
        <div className="shadow-lg rounded-md border-2 relative h-full w-full flex flex-col" style={getGradientStyle()}>
            {/* Lock indicator */}
            {data.locked && (
                <span className="absolute top-1 right-1 z-10 text-slate-500">🔒</span>
            )}

            <NodeResizer
                isVisible={selected && !data.locked}
                minWidth={80}
                minHeight={50}
                lineClassName="border-blue-400"
                handleClassName="h-3 w-3 bg-blue-500 border-2 border-white rounded"
            />

            {/* Top Handles */}
            <Handle type="target" position={Position.Top} id="t" style={{ ...handleStyle, left: '50%' }} className="w-3 h-3 bg-slate-400" />
            <Handle type="source" position={Position.Top} id="t" style={{ ...handleStyle, left: '50%' }} className="w-3 h-3 bg-blue-500" />

            {/* Right Handles */}
            <Handle type="target" position={Position.Right} id="r" style={{ ...handleStyle, top: '50%' }} className="w-3 h-3 bg-slate-400" />
            <Handle type="source" position={Position.Right} id="r" style={{ ...handleStyle, top: '50%' }} className="w-3 h-3 bg-blue-500" />

            {/* Bottom Handles */}
            <Handle type="target" position={Position.Bottom} id="b" style={{ ...handleStyle, left: '50%' }} className="w-3 h-3 bg-slate-400" />
            <Handle type="source" position={Position.Bottom} id="b" style={{ ...handleStyle, left: '50%' }} className="w-3 h-3 bg-blue-500" />

            {/* Left Handles */}
            <Handle type="target" position={Position.Left} id="l" style={{ ...handleStyle, top: '50%' }} className="w-3 h-3 bg-slate-400" />
            <Handle type="source" position={Position.Left} id="l" style={{ ...handleStyle, top: '50%' }} className="w-3 h-3 bg-blue-500" />

            {(showLabel || showStatus) && (
                <div className="p-2 border-b border-slate-200/50 flex items-center justify-between rounded-t-md bg-white/50 backdrop-blur-sm">
                    {showLabel ? <span className="font-bold text-slate-800 truncate mr-2" style={{ fontSize: data.fontSize ? `${Math.max(8, data.fontSize - 4)}px` : '12px' }}>{data.label || mqttSerial}</span> : <span></span>}
                    {showStatus && (isConnected && hasData ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-red-500" />)}
                </div>
            )}

            <div className={`p-3 flex-1 flex items-center ${(!showLabel && !showStatus && !showIcon) ? 'justify-center' : 'justify-between'}`}>
                {showIcon && (
                    <div className="flex items-center gap-2 text-slate-700">
                        {getIcon()}
                        <span className="font-medium" style={{ fontSize: data.fontSize ? `${Math.max(8, data.fontSize - 4)}px` : '12px' }}>{data.type || 'kW'}</span>
                    </div>
                )}
                <div className="font-bold text-slate-900" style={{ fontSize: `${data.fontSize || 16}px` }}>
                    {!hasData ? '...' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
            </div>
        </div>
    );
};

export default memo(MeterNode);
