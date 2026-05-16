import React from 'react';
import { getBezierPath } from 'reactflow';

const CustomEdge = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data
}) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    // Defaults
    const strokeWidth = style.strokeWidth || 2;
    const strokeColor = style.stroke || '#b1b1b7';

    // Gradient Props (matching BoxNode logic)
    const gradientDirection = data?.gradientDirection || 'TL-BR';
    const gradientPercentage = data?.gradientPercentage || 0;
    const borderWidth = data?.borderWidth || 0;
    const borderColor = data?.borderColor || '#000000';

    const gradientId = `edge-gradient-${id}`;

    // Map direction to SVG coordinates
    let x1 = '0%', y1 = '0%', x2 = '100%', y2 = '100%'; // TL-BR
    if (gradientDirection === 'TR-BL') { x1 = '100%'; y1 = '0%'; x2 = '0%'; y2 = '100%'; }
    if (gradientDirection === 'BL-TR') { x1 = '0%'; y1 = '100%'; x2 = '100%'; y2 = '0%'; }
    if (gradientDirection === 'BR-TL') { x1 = '100%'; y1 = '100%'; x2 = '0%'; y2 = '0%'; }
    if (gradientDirection === 'TC-BC') { x1 = '0%'; y1 = '0%'; x2 = '0%'; y2 = '100%'; }
    if (gradientDirection === 'BC-TC') { x1 = '0%'; y1 = '100%'; x2 = '0%'; y2 = '0%'; }

    const useGradient = gradientPercentage > 0;

    return (
        <>
            {/* Gradient Definition */}
            {useGradient && (
                <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                    <defs>
                        <linearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2}>
                            <stop offset="0%" stopColor={strokeColor} />
                            <stop offset={`${gradientPercentage}%`} stopColor="white" />
                        </linearGradient>
                    </defs>
                </svg>
            )}

            {/* Border Path (rendered behind) */}
            {borderWidth > 0 && (
                <path
                    id={`${id}-border`}
                    style={{
                        ...style,
                        strokeWidth: strokeWidth + (borderWidth * 2),
                        stroke: borderColor,
                    }}
                    className="react-flow__edge-path"
                    d={edgePath}
                    markerEnd={markerEnd}
                />
            )}

            {/* Main Path */}
            <path
                id={id}
                style={{
                    ...style,
                    strokeWidth: strokeWidth,
                    stroke: useGradient ? `url(#${gradientId})` : strokeColor,
                }}
                className="react-flow__edge-path"
                d={edgePath}
                markerEnd={markerEnd}
            />
        </>
    );
};

export default CustomEdge;
