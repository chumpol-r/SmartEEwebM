import React, { memo } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';

const BoxNode = ({ data, selected }) => {
    const getGradientStyle = () => {
        const { color = 'rgba(30, 41, 59, 0.5)', gradientDirection = 'TL-BR', gradientPercentage = 0, transparentBackground = false } = data;

        const borderWidth = data.borderWidth !== undefined ? `${data.borderWidth}px` : '2px';
        const borderColor = data.borderColor || color;

        // If transparent background is enabled
        if (transparentBackground) {
            return {
                backgroundColor: 'transparent',
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

        // If percentage is 0, just use the color (no gradient to white)
        if (gradientPercentage === 0) {
            return {
                backgroundColor: color,
                borderWidth: borderWidth,
                borderColor: borderColor,
                borderStyle: 'solid'
            };
        }

        return {
            background: `linear-gradient(${cssDir}, ${color} 0%, white ${gradientPercentage}%)`,
            borderWidth: borderWidth,
            borderColor: borderColor,
            borderStyle: 'solid'
        };
    };

    return (
        <>
            <NodeResizer
                minWidth={50}
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

            <div
                className="h-full w-full rounded-md border-2 border-slate-600 flex items-center justify-center p-2 relative"
                style={getGradientStyle()}
            >
                {data.locked && (
                    <span className="absolute top-1 right-1 text-white/50">🔒</span>
                )}
                {data.label && (
                    <span
                        className="font-medium pointer-events-none select-none"
                        style={{
                            fontSize: `${data.fontSize || 14}px`,
                            color: data.labelColor || '#000000'
                        }}
                    >
                        {data.label}
                    </span>
                )}
            </div>
        </>
    );
};

export default memo(BoxNode);
