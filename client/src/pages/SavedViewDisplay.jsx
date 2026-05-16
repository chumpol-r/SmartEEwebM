import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactFlow, {
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    Controls,
    MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import { useParams } from 'react-router-dom';

// Import node types
import MeterNode from '../components/custom-view/MeterNode';
import ImageNode from '../components/custom-view/ImageNode';
import BoxNode from '../components/custom-view/BoxNode';
import CarbonCreditNode from '../components/custom-view/CarbonCreditNode';
import CarbonTrendNode from '../components/custom-view/CarbonTrendNode';
import TotalConsumptionNode from '../components/custom-view/TotalConsumptionNode';
import PeakDemandNode from '../components/custom-view/PeakDemandNode';
import EstimateCostNode from '../components/custom-view/EstimateCostNode';
import EnergyConsumptionNode from '../components/custom-view/EnergyConsumptionNode';
import RealtimeGraphNode from '../components/custom-view/RealtimeGraphNode';
import EnergyDistributionNode from '../components/custom-view/EnergyDistributionNode';
import CustomEdge from '../components/custom-view/CustomEdge';

const edgeTypes = {
    custom: CustomEdge,
};

const nodeTypes = {
    meter: MeterNode,
    image: ImageNode,
    box: BoxNode,
    carbonCredit: CarbonCreditNode,
    carbonTrend: CarbonTrendNode,
    totalConsumption: TotalConsumptionNode,
    peakDemand: PeakDemandNode,
    estimateCost: EstimateCostNode,
    energyConsumption: EnergyConsumptionNode,
    realtimeGraph: RealtimeGraphNode,
    energyDistribution: EnergyDistributionNode
};

const SavedViewDisplayInner = () => {
    const { id } = useParams();
    const reactFlowWrapper = useRef(null);
    const [nodes, setNodes] = useNodesState([]);
    const [edges, setEdges] = useEdgesState([]);
    const [viewName, setViewName] = useState('');
    const [creatorName, setCreatorName] = useState('');
    const [updatedAt, setUpdatedAt] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadView = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`/api/custom-views/${id}/public`);
                const view = res.data;

                setViewName(view.name);
                setCreatorName(view.creator_name || 'Unknown');
                setUpdatedAt(view.updated_at ? new Date(view.updated_at).toLocaleString('th-TH') : '');

                // Make nodes non-draggable and non-selectable for read-only mode
                const readOnlyNodes = (view.nodes || []).map(node => ({
                    ...node,
                    draggable: false,
                    selectable: false,
                    connectable: false
                }));

                setNodes(readOnlyNodes);
                setEdges(view.edges || []);
                setLoading(false);
            } catch (err) {
                console.error("Failed to load view", err);
                setError("Failed to load view");
                setLoading(false);
            }
        };

        if (id) {
            loadView();
        }
    }, [id, setNodes, setEdges]);

    if (loading) {
        return (
            <div className="flex h-screen bg-slate-900 text-white items-center justify-center">
                <div className="text-lg">Loading view...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen bg-slate-900 text-white items-center justify-center">
                <div className="text-lg text-red-400">{error}</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-slate-900 text-white">
            {/* Header */}
            <div className="h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4">
                <h1 className="text-lg font-semibold">{viewName}</h1>
                <div className="text-sm text-slate-400">
                    <span>Created by: <span className="text-slate-300">{creatorName}</span></span>
                    {updatedAt && <span className="ml-4">Last saved: <span className="text-slate-300">{updatedAt}</span></span>}
                </div>
            </div>

            {/* Canvas - Read Only */}
            <div className="flex-1" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    // Read-only settings
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    panOnDrag={true}
                    zoomOnScroll={true}
                    zoomOnPinch={true}
                    // No dots/grid background
                    style={{ background: '#1e293b' }}
                >
                    <Controls showInteractive={false} />
                    <MiniMap
                        nodeColor="#475569"
                        maskColor="rgba(0,0,0,0.8)"
                        style={{ backgroundColor: '#1e293b' }}
                    />
                </ReactFlow>
            </div>
        </div>
    );
};

const SavedViewDisplay = () => {
    return (
        <ReactFlowProvider>
            <SavedViewDisplayInner />
        </ReactFlowProvider>
    );
};

export default SavedViewDisplay;
