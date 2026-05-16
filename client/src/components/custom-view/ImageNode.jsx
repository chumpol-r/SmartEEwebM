import React, { memo } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';

const ImageNode = ({ data, selected, id }) => {
    // data = { url, label, color, gradientDirection, gradientPercentage, frameStyle, transparentBackground }

    const getContainerStyle = () => {
        const {
            color = '#18498d',
            gradientDirection = 'TL-BR',
            gradientPercentage = 50,
            frameStyle = 'solid', // 'none', 'solid', 'dashed', 'dotted', 'double'
            borderWidth = 2,
            borderColor,
            transparentBackground = false
        } = data;

        // If transparent background is enabled
        if (transparentBackground) {
            if (frameStyle === 'none' || borderWidth === 0) {
                return {
                    background: 'transparent',
                    border: 'none'
                };
            }
            return {
                background: 'transparent',
                borderWidth: `${borderWidth}px`,
                borderColor: borderColor || color,
                borderStyle: frameStyle
            };
        }

        // If frameStyle is 'none' or borderWidth is 0, no border
        if (frameStyle === 'none' || borderWidth === 0) {
            return {
                background: gradientPercentage === 0 ? color : `linear-gradient(to bottom right, ${color} 0%, white ${gradientPercentage}%)`,
                border: 'none'
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
            borderWidth: `${borderWidth}px`,
            borderColor: borderColor || color,
            borderStyle: frameStyle
        };
    };

    // Handle visibility logic
    const handleStyle = { opacity: selected ? 1 : 0, transition: 'opacity 0.2s' };

    return (
        <div className={`shadow-lg rounded-md relative h-full w-full flex flex-col ${data.frameStyle !== 'none' && data.borderWidth !== 0 ? 'border-2' : ''}`} style={getContainerStyle()}>
            <NodeResizer
                isVisible={selected}
                minWidth={100}
                minHeight={100}
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

            <div className="flex-1 overflow-hidden p-2 flex flex-col items-center justify-center">
                {data.url ? (
                    <img
                        src={data.url}
                        alt="Node"
                        className="w-full h-full"
                        style={{ objectFit: data.fit || 'contain' }}
                    />
                ) : (
                    <div className="text-slate-400 text-xs text-center">No Image</div>
                )}
                {data.label && <div className="text-xs font-bold text-slate-800 mt-1">{data.label}</div>}
            </div>
        </div>
    );
};

export default memo(ImageNode);
