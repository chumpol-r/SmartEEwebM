import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import axios from 'axios';
import { Leaf } from 'lucide-react';

const CarbonCreditNode = ({ data, selected }) => {
    const [emissionValue, setEmissionValue] = useState(0);
    const [loading, setLoading] = useState(false);

    // Gradient handling
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
            borderRadius: '6px', // Match rounded-md (usually 6px or 0.375rem)
            color: '#fff',
            fontSize: '12px',
            fontWeight: 'bold',
            position: 'relative',
            overflow: 'hidden',
            borderWidth: data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px',
            borderColor: data.borderColor || color,
            borderStyle: 'solid',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' // Match shadow-lg
        };

        // If transparent background is enabled
        if (transparentBackground) {
            return {
                ...baseStyle,
                background: 'transparent'
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
                // Fetch data for the selected time range (default to 'day')
                const timeRange = data.timeRange || 'day';
                const res = await axios.get(`/api/carbon-credit/data?timeRange=${timeRange}`);

                // Calculate total emission from the response array
                // The API returns [{ time: '...', energy: ..., emission: ... }, ...]
                const totalEmission = res.data.reduce((sum, item) => sum + (item.emission || 0), 0);

                setEmissionValue(totalEmission);
            } catch (err) {
                console.error("Failed to fetch carbon credit data", err);
                setEmissionValue(0);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Set up an interval to refresh data periodically (e.g., every minute)
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [data.timeRange]);

    return (
        <>
            <NodeResizer
                minWidth={100}
                minHeight={50}
                isVisible={selected}
                lineClassName="border-blue-500"
                handleClassName="h-3 w-3 bg-white border-2 border-blue-500 rounded"
            />

            {/* Handles - Visible when selected or connecting */}
            <Handle type="target" position={Position.Top} id="t" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Right} id="r" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Bottom} id="b" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="target" position={Position.Left} id="l" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />

            <Handle type="source" position={Position.Top} id="t" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="source" position={Position.Right} id="r" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="source" position={Position.Bottom} id="b" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
            <Handle type="source" position={Position.Left} id="l" className={`w-3 h-3 bg-blue-500 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />

            <div style={getStyle()}>
                <div className="flex flex-col items-center gap-1 z-10 p-2 text-center">
                    <Leaf size={24} className="text-white/90" />
                    <div className="text-lg font-bold drop-shadow-md text-slate-800">
                        {loading ? '...' : emissionValue.toFixed(2)}
                    </div>
                    <div className="text-[10px] opacity-80 uppercase tracking-wider text-slate-700">
                        kgCO₂e ({data.timeRange || 'Day'})
                    </div>
                </div>
            </div>
        </>
    );
};

export default memo(CarbonCreditNode);
