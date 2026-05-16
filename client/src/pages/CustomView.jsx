import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ReactFlow, {
    ReactFlowProvider,
    addEdge,
    useNodesState,
    useEdgesState,
    Controls,
    Background,
    MiniMap,
    Panel,
    getIncomers,
    getOutgoers,
    getConnectedEdges
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import {
    Save,
    Plus,
    Trash2,
    Settings,
    Layout,
    Type,
    Image as ImageIcon,
    MousePointer2,
    Move,
    Hand,
    Box,
    ChevronDown,
    ChevronRight,
    Search,
    Leaf,
    Zap,
    TrendingUp,
    DollarSign,
    BarChart2,
    Activity,
    PieChart,
    Share2,
    LogOut,
    User,
    ArrowLeft
} from 'lucide-react';
import Autocomplete from '../components/Autocomplete';
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
import { useToast } from '../components/Toast';

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

const CustomView = () => {
    const reactFlowWrapper = useRef(null);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [reactFlowInstance, setReactFlowInstance] = useState(null);
    const toast = useToast();
    const navigate = useNavigate();

    // User state for header
    const [user, setUser] = useState(null);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    const [views, setViews] = useState([]);
    const [currentViewId, setCurrentViewId] = useState(null);
    const [viewName, setViewName] = useState('New Dashboard');
    const [meters, setMeters] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [selectedEdge, setSelectedEdge] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);

    // Permission State
    const [permissions, setPermissions] = useState({ view: false, insert: false, update: false, delete: false, admin: false });
    const [permLoading, setPermLoading] = useState(true);

    // Meter List State
    // Meter List State
    const [isMetersExpanded, setIsMetersExpanded] = useState(true);
    const [isToolsExpanded, setIsToolsExpanded] = useState(true);
    const [isViewsExpanded, setIsViewsExpanded] = useState(true);
    const [meterSearchTerm, setMeterSearchTerm] = useState('');
    const [analysisSearchTerm, setAnalysisSearchTerm] = useState('');
    const [viewSearchTerm, setViewSearchTerm] = useState('');

    // Cursor Mode: 'select' for selecting nodes, 'pan' for panning canvas
    const [cursorMode, setCursorMode] = useState('pan');
    const [ctrlPressed, setCtrlPressed] = useState(false);

    // Image Upload Ref
    const fileInputRef = useRef(null);

    // Default Edge Style
    const [defaultEdgeStyle, setDefaultEdgeStyle] = useState({
        strokeWidth: 2,
        stroke: '#b1b1b7',
        type: 'custom'
    });

    // Default Box Style
    const [defaultBoxStyle, setDefaultBoxStyle] = useState({
        color: '#6c757d',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50
    });

    // Default Meter Style
    const [defaultMeterStyle, setDefaultMeterStyle] = useState({
        color: '#007bff',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        type: 'kW',
        showLabel: true,
        showIcon: true,
        showStatus: true
    });

    // Default Image Style
    const [defaultImageStyle, setDefaultImageStyle] = useState({
        color: '#ffffff',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        fit: 'contain'
    });

    // Default Carbon Credit Style
    const [defaultCarbonCreditStyle, setDefaultCarbonCreditStyle] = useState({
        color: '#10b981',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        timeRange: 'day'
    });

    // Default Carbon Trend Style
    const [defaultCarbonTrendStyle, setDefaultCarbonTrendStyle] = useState({
        color: '#10b981',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        timeRange: 'day'
    });

    // Default Energy Consumption Style
    const [defaultEnergyConsumptionStyle, setDefaultEnergyConsumptionStyle] = useState({
        color: '#3b82f6',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        timeRange: 'day'
    });

    // Default Realtime Graph Style
    const [defaultRealtimeGraphStyle, setDefaultRealtimeGraphStyle] = useState({
        color: '#ef4444',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        timeWindow: 5, // Minutes
        dataType: 'KW'
    });

    // Default Energy Distribution Style
    const [defaultEnergyDistributionStyle, setDefaultEnergyDistributionStyle] = useState({
        color: '#8884d8',
        gradientDirection: 'TL-BR',
        gradientPercentage: 50,
        timeRange: 'day',
        chartType: 'bar'
    });

    // Default Analysis Style
    const [defaultAnalysisStyle, setDefaultAnalysisStyle] = useState({
        totalConsumption: { color: '#3b82f6', gradientDirection: 'TL-BR', gradientPercentage: 50, timeRange: 'day' },
        peakDemand: { color: '#f97316', gradientDirection: 'TL-BR', gradientPercentage: 50, timeRange: 'day' },
        estimateCost: { color: '#10b981', gradientDirection: 'TL-BR', gradientPercentage: 50, timeRange: 'day' }
    });

    // Fetch Initial Data
    useEffect(() => {
        const init = async () => {
            await checkPermissions();
        }
        init();
    }, []);

    const checkPermissions = async () => {
        try {
            const res = await axios.get('/api/user/permissions/41', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            const perms = res.data;
            setPermissions(perms);

            if (!perms.view) {
                navigate('/access-denied');
            } else {
                fetchMeters();
                fetchViews();
            }
        } catch (err) {
            console.error("Failed to check permissions", err);
            navigate('/access-denied');
        } finally {
            setPermLoading(false);
        }
    };

    // Keyboard listener for Control key to toggle pan mode
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Control' && !ctrlPressed) {
                setCtrlPressed(true);
            }
        };

        const handleKeyUp = (e) => {
            if (e.key === 'Control') {
                setCtrlPressed(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [ctrlPressed]);

    // Determine effective mode: if ctrl is pressed, toggle the mode
    const effectiveMode = ctrlPressed
        ? (cursorMode === 'select' ? 'pan' : 'select')
        : cursorMode;

    const fetchMeters = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/meters', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setMeters(res.data);
        } catch (err) {
            console.error("Failed to fetch meters", err);
        }
    };

    const fetchViews = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/custom-views', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setViews(res.data);
        } catch (err) {
            console.error("Failed to fetch views", err);
        }
    };

    const loadView = async (id) => {
        try {
            const res = await axios.get(`/api/custom-views/${id}`);
            const view = res.data;

            setCurrentViewId(view.id);
            setViewName(view.name);
            setNodes(view.nodes || []);
            setEdges(view.edges || []);

            if (view.defaultEdgeStyle) setDefaultEdgeStyle(view.defaultEdgeStyle);
            if (view.defaultBoxStyle) setDefaultBoxStyle(view.defaultBoxStyle);
            if (view.defaultMeterStyle) setDefaultMeterStyle(view.defaultMeterStyle);
            if (view.defaultImageStyle) setDefaultImageStyle(view.defaultImageStyle);
            if (view.defaultCarbonCreditStyle) setDefaultCarbonCreditStyle(view.defaultCarbonCreditStyle);
            if (view.defaultCarbonTrendStyle) setDefaultCarbonTrendStyle(view.defaultCarbonTrendStyle);
            if (view.defaultEnergyConsumptionStyle) setDefaultEnergyConsumptionStyle(view.defaultEnergyConsumptionStyle);
            if (view.defaultRealtimeGraphStyle) setDefaultRealtimeGraphStyle(view.defaultRealtimeGraphStyle);
            if (view.defaultEnergyDistributionStyle) setDefaultEnergyDistributionStyle(view.defaultEnergyDistributionStyle);
            if (view.defaultAnalysisStyle) setDefaultAnalysisStyle(view.defaultAnalysisStyle);

        } catch (err) {
            console.error("Failed to load view", err);
            toast.error("Failed to load view");
        }
    };

    const saveView = async () => {
        if (!viewName.trim()) {
            toast.warning("View name cannot be empty.");
            return;
        }
        const viewData = {
            name: viewName,
            nodes: nodes,
            edges: edges,
            defaultEdgeStyle: defaultEdgeStyle,
            defaultBoxStyle: defaultBoxStyle,
            defaultMeterStyle: defaultMeterStyle,
            defaultImageStyle: defaultImageStyle,
            defaultCarbonCreditStyle: defaultCarbonCreditStyle,
            defaultCarbonTrendStyle: defaultCarbonTrendStyle,
            defaultEnergyConsumptionStyle: defaultEnergyConsumptionStyle,
            defaultRealtimeGraphStyle: defaultRealtimeGraphStyle,
            defaultEnergyDistributionStyle: defaultEnergyDistributionStyle,
            defaultAnalysisStyle: defaultAnalysisStyle
        };

        try {
            const token = localStorage.getItem('token');
            if (currentViewId) {
                await axios.put(`/api/custom-views/${currentViewId}`, viewData, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success("View updated successfully!");
            } else {
                const res = await axios.post('/api/custom-views', viewData, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setCurrentViewId(res.data.id);
                toast.success("View saved successfully!");
            }
            fetchViews(); // Refresh the list of views
        } catch (err) {
            console.error("Failed to save view", err);
            const errMsg = err.response?.data || err.message || "Unknown error";
            toast.error(`Failed to save view: ${errMsg}`);
        }
    };

    const saveAsNew = async () => {
        if (!viewName.trim()) {
            toast.warning("View name cannot be empty.");
            return;
        }
        // Ensure unique name or let backend handle it? 
        // For now, just append (Copy) if it's the same name, or let user change it.
        // The user can change the name in the input before clicking "Save as New".

        const viewData = {
            name: viewName, // User should change this if they want a new name
            nodes: nodes,
            edges: edges,
            defaultEdgeStyle: defaultEdgeStyle,
            defaultBoxStyle: defaultBoxStyle,
            defaultMeterStyle: defaultMeterStyle,
            defaultImageStyle: defaultImageStyle,
            defaultCarbonCreditStyle: defaultCarbonCreditStyle,
            defaultCarbonTrendStyle: defaultCarbonTrendStyle,
            defaultEnergyConsumptionStyle: defaultEnergyConsumptionStyle,
            defaultRealtimeGraphStyle: defaultRealtimeGraphStyle,
            defaultEnergyDistributionStyle: defaultEnergyDistributionStyle,
            defaultAnalysisStyle: defaultAnalysisStyle
        };

        try {
            const token = localStorage.getItem('token');
            const res = await axios.post('/api/custom-views', viewData, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setCurrentViewId(res.data.id);
            toast.success("View saved as new successfully!");
            fetchViews();
        } catch (err) {
            console.error("Failed to save view as new", err);
            const errMsg = err.response?.data || err.message || "Unknown error";
            toast.error(`Failed to save view as new: ${errMsg}`);
        }
    };

    const deleteView = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this view?")) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`/api/custom-views/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success("View deleted successfully!");
            if (currentViewId === id) {
                setCurrentViewId(null);
                setViewName('New Dashboard');
                setNodes([]);
                setEdges([]);
            }
            fetchViews();
        } catch (err) {
            console.error("Failed to delete view", err);
            toast.error("Failed to delete view");
        }
    };

    const toggleExport = async (id, isExported, e) => {
        e.stopPropagation();
        try {
            const token = localStorage.getItem('token');
            if (isExported) {
                // Unexport
                await axios.post(`/api/custom-views/${id}/unexport`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success("View removed from menu!");
            } else {
                // Export
                await axios.post(`/api/custom-views/${id}/export`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success("View exported to menu!");
            }
            fetchViews();
        } catch (err) {
            console.error("Failed to toggle export", err);
            toast.error("Failed to toggle export");
        }
    };

    const onConnect = useCallback((params) => {
        const newEdge = {
            ...params,
            type: 'custom',
            data: {
                useGradient: false,
                gradientColor: '#ffffff',
                borderWidth: 0,
                borderColor: '#000000'
            },
            style: {
                strokeWidth: defaultEdgeStyle.strokeWidth,
                stroke: defaultEdgeStyle.stroke
            }
        };
        setEdges((eds) => addEdge(newEdge, eds));
    }, [defaultEdgeStyle, setEdges]);

    const onConnectStart = useCallback(() => {
        setIsConnecting(true);
    }, []);

    const onConnectEnd = useCallback(() => {
        setIsConnecting(false);
    }, []);

    const onDragStart = (event, nodeType, meterData = null) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';

        if (nodeType === 'meter' && meterData) {
            event.dataTransfer.setData('application/meterData', JSON.stringify(meterData));
        }
    };

    const onDragOver = useCallback((event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event) => {
            event.preventDefault();

            const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
            const type = event.dataTransfer.getData('application/reactflow');
            const meterDataString = event.dataTransfer.getData('application/meterData');
            const meterData = meterDataString ? JSON.parse(meterDataString) : null;

            // check if the dropped element is valid
            if (typeof type === 'undefined' || !type) {
                return;
            }

            const position = reactFlowInstance.project({
                x: event.clientX - reactFlowBounds.left,
                y: event.clientY - reactFlowBounds.top,
            });

            let newNode;
            if (type === 'meter' && meterData) {
                // Extract serial for MQTT - prefer 'serial' field, otherwise use 'val'
                // Also strip 'Domain\' prefix if present (like Realtime.jsx does)
                let meterSerial = meterData.serial || meterData.val;
                if (typeof meterSerial === 'string' && meterSerial.includes('\\')) {
                    meterSerial = meterSerial.split('\\')[1];
                }

                newNode = {
                    id: `meter-${meterData.val}-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: meterData.name,
                        meterId: meterData.val,
                        serial: meterSerial, // Added for MQTT subscription
                        type: defaultMeterStyle.type,
                        color: defaultMeterStyle.color,
                        gradientDirection: defaultMeterStyle.gradientDirection,
                        gradientPercentage: defaultMeterStyle.gradientPercentage,
                        showLabel: defaultMeterStyle.showLabel,
                        showIcon: defaultMeterStyle.showIcon,
                        showStatus: defaultMeterStyle.showStatus
                    },
                    style: { width: 150, height: 100 },
                };
                console.log("Creating new meter node:", newNode);
            } else if (type === 'image') {
                newNode = {
                    id: `image-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Image',
                        url: '',
                        fit: 'contain',
                        color: defaultImageStyle.color,
                        gradientDirection: defaultImageStyle.gradientDirection,
                        gradientPercentage: defaultImageStyle.gradientPercentage
                    },
                    style: { width: 200, height: 200 },
                };
            } else if (type === 'box') {
                newNode = {
                    id: `box-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Box',
                        color: defaultBoxStyle.color,
                        gradientDirection: defaultBoxStyle.gradientDirection,
                        gradientPercentage: defaultBoxStyle.gradientPercentage
                    },
                    style: { width: 150, height: 100 },
                };
            } else if (type === 'carbonCredit') {
                newNode = {
                    id: `carbon-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Carbon Credit',
                        color: defaultCarbonCreditStyle.color,
                        gradientDirection: defaultCarbonCreditStyle.gradientDirection,
                        gradientPercentage: defaultCarbonCreditStyle.gradientPercentage,
                        timeRange: defaultCarbonCreditStyle.timeRange
                    },
                    style: { width: 150, height: 100 },
                };
            } else if (type === 'carbonTrend') {
                newNode = {
                    id: `carbonTrend-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Carbon Trend',
                        color: defaultCarbonTrendStyle.color,
                        gradientDirection: defaultCarbonTrendStyle.gradientDirection,
                        gradientPercentage: defaultCarbonTrendStyle.gradientPercentage,
                        timeRange: defaultCarbonTrendStyle.timeRange
                    },
                    style: { width: 300, height: 200 },
                };
            } else if (type === 'energyConsumption') {
                newNode = {
                    id: `energy-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Energy Consumption',
                        color: defaultEnergyConsumptionStyle.color,
                        gradientDirection: defaultEnergyConsumptionStyle.gradientDirection,
                        gradientPercentage: defaultEnergyConsumptionStyle.gradientPercentage,
                        timeRange: defaultEnergyConsumptionStyle.timeRange
                    },
                    style: { width: 400, height: 300 },
                };
            } else if (type === 'realtimeGraph') {
                newNode = {
                    id: `realtime-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Realtime Graph',
                        color: defaultRealtimeGraphStyle.color,
                        gradientDirection: defaultRealtimeGraphStyle.gradientDirection,
                        gradientPercentage: defaultRealtimeGraphStyle.gradientPercentage,
                        timeWindow: defaultRealtimeGraphStyle.timeWindow,
                        meterIds: []
                    },
                    style: { width: 400, height: 300 },
                };
            } else if (type === 'energyDistribution') {
                newNode = {
                    id: `dist-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Energy Distribution',
                        color: defaultEnergyDistributionStyle.color,
                        gradientDirection: defaultEnergyDistributionStyle.gradientDirection,
                        gradientPercentage: defaultEnergyDistributionStyle.gradientPercentage,
                        timeRange: defaultEnergyDistributionStyle.timeRange,
                        chartType: defaultEnergyDistributionStyle.chartType,
                        meterIds: []
                    },
                    style: { width: 400, height: 300 },
                };
            } else if (type === 'totalConsumption') {
                newNode = {
                    id: `consumption-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Consumption',
                        color: defaultAnalysisStyle.totalConsumption.color,
                        gradientDirection: defaultAnalysisStyle.totalConsumption.gradientDirection,
                        gradientPercentage: defaultAnalysisStyle.totalConsumption.gradientPercentage,
                        timeRange: defaultAnalysisStyle.totalConsumption.timeRange
                    },
                    style: { width: 150, height: 100 },
                };
            } else if (type === 'peakDemand') {
                newNode = {
                    id: `peak-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Peak Demand',
                        color: defaultAnalysisStyle.peakDemand.color,
                        gradientDirection: defaultAnalysisStyle.peakDemand.gradientDirection,
                        gradientPercentage: defaultAnalysisStyle.peakDemand.gradientPercentage,
                        timeRange: defaultAnalysisStyle.peakDemand.timeRange
                    },
                    style: { width: 150, height: 100 },
                };
            } else if (type === 'estimateCost') {
                newNode = {
                    id: `cost-${nodes.length + 1}`,
                    type,
                    position,
                    data: {
                        label: 'Estimate Cost',
                        color: defaultAnalysisStyle.estimateCost.color,
                        gradientDirection: defaultAnalysisStyle.estimateCost.gradientDirection,
                        gradientPercentage: defaultAnalysisStyle.estimateCost.gradientPercentage,
                        timeRange: defaultAnalysisStyle.estimateCost.timeRange
                    },
                    style: { width: 150, height: 100 },
                };
            } else {
                return;
            }

            setNodes((nds) => nds.concat(newNode));
            setSelectedNode(newNode);
            setSelectedEdge(null);
        },
        [reactFlowInstance, nodes, setNodes, defaultMeterStyle, defaultBoxStyle, defaultCarbonCreditStyle, defaultAnalysisStyle],
    );

    const onNodeClick = useCallback((event, node) => {
        event.stopPropagation(); // Prevent pane click
        console.log("onNodeClick", node);
        setSelectedNode(node);
        setSelectedEdge(null); // Deselect any edge
    }, []);

    const onEdgeClick = useCallback((event, edge) => {
        event.stopPropagation(); // Prevent pane click
        setSelectedEdge(edge);
        setSelectedNode(null); // Deselect any node
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
        setSelectedEdge(null);
    }, []);

    const updateNodeData = useCallback((key, value) => {
        setNodes((nds) =>
            nds.map((node) =>
                node.id === selectedNode.id
                    ? { ...node, data: { ...node.data, [key]: value } }
                    : node
            )
        );
        setSelectedNode((prev) => ({
            ...prev,
            data: { ...prev.data, [key]: value },
        }));
    }, [selectedNode, setNodes]);

    // Update node position (X, Y)
    const updateNodePosition = useCallback((axis, value) => {
        const numValue = parseFloat(value) || 0;
        setNodes((nds) =>
            nds.map((node) =>
                node.id === selectedNode.id
                    ? { ...node, position: { ...node.position, [axis]: numValue } }
                    : node
            )
        );
        setSelectedNode((prev) => ({
            ...prev,
            position: { ...prev.position, [axis]: numValue },
        }));
    }, [selectedNode, setNodes]);

    const updateNodeStyle = useCallback((key, value) => {
        setNodes((nds) =>
            nds.map((node) =>
                node.id === selectedNode.id
                    ? { ...node, style: { ...node.style, [key]: value } }
                    : node
            )
        );
        setSelectedNode((prev) => ({
            ...prev,
            style: { ...prev.style, [key]: value },
        }));
    }, [selectedNode, setNodes]);

    const updateEdgeStyle = useCallback((key, value) => {
        setEdges((eds) =>
            eds.map((edge) =>
                edge.id === selectedEdge.id
                    ? { ...edge, style: { ...edge.style, [key]: value } }
                    : edge
            )
        );
        setSelectedEdge((prev) => ({
            ...prev,
            style: { ...prev.style, [key]: value },
        }));
    }, [selectedEdge, setEdges]);

    const updateEdgeData = useCallback((key, value) => {
        setEdges((eds) =>
            eds.map((edge) =>
                edge.id === selectedEdge.id
                    ? { ...edge, data: { ...edge.data, [key]: value } }
                    : edge
            )
        );
        setSelectedEdge((prev) => ({
            ...prev,
            data: { ...prev.data, [key]: value },
        }));
    }, [selectedEdge, setEdges]);

    const handleImageUpload = useCallback((event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const imageUrl = reader.result;
                const nodeId = fileInputRef.current.dataset.nodeId;

                if (nodeId) {
                    // Replace existing node's image
                    setNodes((nds) => nds.map(n => {
                        if (n.id === nodeId) {
                            return { ...n, data: { ...n.data, url: imageUrl } };
                        }
                        return n;
                    }));

                    // Update selected node state if it's the one being modified
                    if (selectedNode && selectedNode.id === nodeId) {
                        setSelectedNode(prev => ({ ...prev, data: { ...prev.data, url: imageUrl } }));
                    }

                    delete fileInputRef.current.dataset.nodeId;
                } else {
                    // Create new node
                    const positionString = fileInputRef.current.dataset.position;
                    const position = positionString ? JSON.parse(positionString) : { x: 0, y: 0 };

                    const newNode = {
                        id: `image-${nodes.length + 1}`,
                        type: 'image',
                        position,
                        data: {
                            label: 'Image',
                            url: imageUrl,
                            fit: defaultImageStyle.fit,
                            color: defaultImageStyle.color,
                            gradientDirection: defaultImageStyle.gradientDirection,
                            gradientPercentage: defaultImageStyle.gradientPercentage
                        },
                        style: { width: 200, height: 150 },
                    };
                    setNodes((nds) => nds.concat(newNode));
                    delete fileInputRef.current.dataset.position;
                }
                fileInputRef.current.value = ''; // Clear the input
            };
            reader.readAsDataURL(file);
        }
    }, [nodes, setNodes, selectedNode]);

    // Filter meters based on search term
    const filteredMeters = meters.filter(meter =>
        (meter.displayName || meter.name || '').toLowerCase().includes(meterSearchTerm.toLowerCase()) ||
        String(meter.val || '').toLowerCase().includes(meterSearchTerm.toLowerCase())
    );

    // Filter views based on search term
    const filteredViews = views.filter(view =>
        view.name.toLowerCase().includes(viewSearchTerm.toLowerCase())
    );

    const onNodesDelete = useCallback(
        (deleted) => {
            setEdges(
                deleted.reduce((acc, node) => {
                    const incomers = getIncomers(node, nodes, edges);
                    const outgoers = getOutgoers(node, nodes, edges);
                    const connectedEdges = getConnectedEdges([node], edges);

                    const remainingEdges = acc.filter(
                        (edge) => !connectedEdges.includes(edge),
                    );

                    const createdEdges = incomers.flatMap(({ id: source }) =>
                        outgoers.map(({ id: target }) => ({
                            id: `${source}->${target}`,
                            source,
                            target,
                        })),
                    );

                    return [...remainingEdges, ...createdEdges];
                }, edges),
            );

            // Clear selection if selected node is deleted
            if (selectedNode && deleted.some(n => n.id === selectedNode.id)) {
                setSelectedNode(null);
            }
        },
        [nodes, edges, selectedNode, setEdges],
    );

    if (permLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Checking permissions...</div>;

    return (
        <div className={`flex h-full bg-slate-900 text-white ${isConnecting ? 'connecting-mode' : ''}`}>
            {/* Header removed to use Global Layout Header */}

            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={handleImageUpload}
            />

            {/* Sidebar */}
            <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="font-bold text-lg flex items-center gap-2">
                        <Layout size={20} className="text-blue-400" />
                        Custom View
                    </h2>
                    <button
                        onClick={() => {
                            // Check if there are unsaved changes
                            if (nodes.length > 0 || edges.length > 0) {
                                toast.warning("Starting new view. Previous unsaved changes were cleared.");
                            }
                            setViewName('New Dashboard');
                            setNodes([]);
                            setEdges([]);
                            setCurrentViewId(null);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded transition-colors shadow-lg shadow-blue-900/20"
                        title="New View"
                    >
                        <Plus size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* Views List */}
                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer mb-3"
                            onClick={() => setIsViewsExpanded(!isViewsExpanded)}
                        >
                            <h3 className="text-xs font-semibold text-slate-400 uppercase">Saved Views</h3>
                            {isViewsExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        </div>

                        {isViewsExpanded && (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-2 top-1.5 text-slate-500" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search views..."
                                        value={viewSearchTerm}
                                        onChange={(e) => setViewSearchTerm(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded pl-8 pr-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                                    {filteredViews.map(v => (
                                        <div
                                            key={v.id}
                                            className={`w-full text-left px-3 py-2 rounded text-sm flex items-center group ${currentViewId === v.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}
                                        >
                                            <button
                                                onClick={() => loadView(v.id)}
                                                className="truncate flex-1 text-left"
                                            >
                                                {v.name}
                                            </button>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => toggleExport(v.id, v.exported_to_menu, e)}
                                                    className={`p-1 rounded ${v.exported_to_menu ? 'text-green-400 hover:text-green-300' : 'text-slate-500 hover:text-blue-400'}`}
                                                    title={v.exported_to_menu ? 'Remove from Menu' : 'Export to Menu'}
                                                >
                                                    <Share2 size={14} />
                                                </button>
                                                <button
                                                    onClick={(e) => deleteView(v.id, e)}
                                                    className="text-slate-500 hover:text-red-400 p-1"
                                                    title="Delete View"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                            {v.exported_to_menu ? (
                                                <span className="ml-1 text-xs text-green-400" title="Exported to Menu">●</span>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mb-6">
                        <div
                            className="flex items-center justify-between cursor-pointer mb-3"
                            onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                        >
                            <h3 className="text-xs font-semibold text-slate-400 uppercase">Tools</h3>
                            {isToolsExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        </div>

                        {isToolsExpanded && (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-2 top-1.5 text-slate-500" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search tools..."
                                        value={analysisSearchTerm}
                                        onChange={(e) => setAnalysisSearchTerm(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded pl-8 pr-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {['Image', 'Box', 'Carbon Credit', 'Consumption', 'Peak Demand', 'Estimate Cost', 'Carbon Trend', 'Energy Consumption', 'Realtime Graph', 'Energy Distribution'].filter(t => t.toLowerCase().includes(analysisSearchTerm.toLowerCase())).map(tool => {
                                        let icon, type, label;
                                        if (tool === 'Image') { icon = <ImageIcon size={20} className="text-purple-400" />; type = 'image'; label = 'Image'; }
                                        if (tool === 'Box') { icon = <Box size={20} style={{ color: defaultBoxStyle.color }} />; type = 'box'; label = 'Box'; }
                                        if (tool === 'Carbon Credit') { icon = <Leaf size={20} className="text-emerald-400" />; type = 'carbonCredit'; label = 'Carbon Credit'; }
                                        if (tool === 'Consumption') { icon = <Zap size={20} className="text-blue-400" />; type = 'totalConsumption'; label = 'Consumption'; }
                                        if (tool === 'Peak Demand') { icon = <TrendingUp size={20} className="text-orange-400" />; type = 'peakDemand'; label = 'Peak Demand'; }
                                        if (tool === 'Estimate Cost') { icon = <DollarSign size={20} className="text-green-500" />; type = 'estimateCost'; label = 'Estimate Cost'; }
                                        if (tool === 'Carbon Trend') { icon = <BarChart2 size={20} className="text-emerald-400" />; type = 'carbonTrend'; label = 'Carbon Trend'; }
                                        if (tool === 'Energy Consumption') { icon = <BarChart2 size={20} className="text-blue-400" />; type = 'energyConsumption'; label = 'Energy Consumption'; }
                                        if (tool === 'Realtime Graph') { icon = <Activity size={20} className="text-red-400" />; type = 'realtimeGraph'; label = 'Realtime Graph'; }
                                        if (tool === 'Energy Distribution') { icon = <PieChart size={20} className="text-purple-400" />; type = 'energyDistribution'; label = 'Energy Distribution'; }

                                        return (
                                            <div
                                                key={tool}
                                                className="bg-slate-800 p-3 rounded border border-slate-700 hover:border-blue-500 cursor-grab active:cursor-grabbing flex flex-col items-center gap-2 transition-colors"
                                                onDragStart={(event) => onDragStart(event, type)}
                                                draggable
                                            >
                                                {icon}
                                                <span className="text-xs text-slate-300 text-center">{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <div
                            className="flex items-center justify-between cursor-pointer mb-3"
                            onClick={() => setIsMetersExpanded(!isMetersExpanded)}
                        >
                            <h3 className="text-xs font-semibold text-slate-400 uppercase">Meters</h3>
                            {isMetersExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        </div>

                        {isMetersExpanded && (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-2 top-1.5 text-slate-500" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search meters..."
                                        value={meterSearchTerm}
                                        onChange={(e) => setMeterSearchTerm(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded pl-8 pr-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                    {filteredMeters.map((meter) => (
                                        <div
                                            key={meter.val}
                                            className="bg-slate-800 p-2 rounded border border-slate-700 hover:border-blue-500 cursor-grab active:cursor-grabbing flex items-center gap-2 transition-colors"
                                            onDragStart={(event) => onDragStart(event, 'meter', meter)}
                                            draggable
                                        >
                                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                            <span className="text-sm text-slate-300 truncate">{meter.displayName || meter.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Canvas */}
            <div className={`flex-1 h-full relative ${effectiveMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : ''}`} ref={reactFlowWrapper}>
                <ReactFlowProvider>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onConnectStart={onConnectStart}
                        onConnectEnd={onConnectEnd}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onNodeClick={onNodeClick}
                        onEdgeClick={onEdgeClick}
                        onPaneClick={onPaneClick}
                        onNodesDelete={onNodesDelete}
                        deleteKeyCode={['Backspace', 'Delete']}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        selectionOnDrag={effectiveMode === 'select'}
                        selectionMode="partial"
                        panOnDrag={effectiveMode === 'pan' ? [0, 1, 2] : [1, 2]}
                        fitView
                        className="bg-slate-900"
                    >
                        <Controls />
                        <MiniMap style={{ height: 120 }} zoomable pannable />
                        <Background color="#334155" gap={16} />

                        {/* Cursor Mode Toggle */}
                        <Panel position="top-left" className="bg-slate-800 p-1 rounded border border-slate-700 flex gap-1">
                            <button
                                onClick={() => setCursorMode('select')}
                                className={`p-2 rounded transition-colors ${cursorMode === 'select' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                                title="Selection Mode (Ctrl to toggle)"
                            >
                                <MousePointer2 size={18} />
                            </button>
                            <button
                                onClick={() => setCursorMode('pan')}
                                className={`p-2 rounded transition-colors ${cursorMode === 'pan' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                                title="Pan Mode (Ctrl to toggle)"
                            >
                                <Hand size={18} />
                            </button>
                            {ctrlPressed && (
                                <span className="px-2 py-1 text-xs text-yellow-400 flex items-center">
                                    Ctrl
                                </span>
                            )}
                        </Panel>

                        <Panel position="top-right" className="bg-slate-800 p-2 rounded border border-slate-700 flex gap-2">

                            <input
                                type="text"
                                value={viewName}
                                onChange={(e) => {
                                    console.log("Typing:", e.target.value);
                                    setViewName(e.target.value);
                                }}
                                onKeyDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="nodrag bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 text-white"
                            />
                            {currentViewId ? (
                                <>
                                    <button onClick={saveView} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm flex items-center gap-1 transition-colors">
                                        <Save size={14} /> Update
                                    </button>
                                    <button
                                        onClick={() => {
                                            setCurrentViewId(null);
                                            // Use a timeout to allow state to update before saving, or just call saveView logic directly with null id.
                                            // Actually, saveView checks currentViewId from state. 
                                            // State updates are async. We need to handle this carefully.
                                            // Let's create a specific saveAsNew function or modify saveView to accept an argument.
                                            // For simplicity, let's modify saveView to check a flag or just handle it here.
                                            // Better: create a wrapper.
                                            saveAsNew();
                                        }}
                                        className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm flex items-center gap-1 transition-colors"
                                    >
                                        <Plus size={14} /> Save as New
                                    </button>
                                </>
                            ) : (
                                <button onClick={saveView} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm flex items-center gap-1 transition-colors">
                                    <Save size={14} /> Save
                                </button>
                            )}
                        </Panel>
                    </ReactFlow>
                </ReactFlowProvider>
            </div>

            {/* Properties Panel */}
            < div className="w-72 bg-slate-800 border-l border-slate-700 p-4 overflow-y-auto" >
                {selectedNode ? (
                    <>
                        <h3 className="font-bold mb-4 flex items-center gap-2 text-white">
                            <Settings size={18} className="text-blue-400" />
                            Properties
                        </h3>

                        {selectedNode && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Label</label>
                                    <input
                                        type="text"
                                        value={selectedNode.data.label}
                                        onChange={(e) => updateNodeData('label', e.target.value)}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                {/* Position & Size Controls */}
                                <div className="border-t border-slate-700 pt-3">
                                    <label className="block text-xs text-slate-400 mb-2">Position & Size</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-[10px] text-slate-500">X</label>
                                            <input
                                                type="number"
                                                value={Math.round(selectedNode.position?.x || 0)}
                                                onChange={(e) => updateNodePosition('x', e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                disabled={selectedNode.data.locked}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-slate-500">Y</label>
                                            <input
                                                type="number"
                                                value={Math.round(selectedNode.position?.y || 0)}
                                                onChange={(e) => updateNodePosition('y', e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                disabled={selectedNode.data.locked}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-slate-500">Width</label>
                                            <input
                                                type="number"
                                                value={selectedNode.style?.width || 150}
                                                onChange={(e) => updateNodeStyle('width', parseInt(e.target.value) || 150)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                disabled={selectedNode.data.locked}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-slate-500">Height</label>
                                            <input
                                                type="number"
                                                value={selectedNode.style?.height || 100}
                                                onChange={(e) => updateNodeStyle('height', parseInt(e.target.value) || 100)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                disabled={selectedNode.data.locked}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Lock Position & Size */}
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="lockNode"
                                        checked={selectedNode.data.locked || false}
                                        onChange={(e) => {
                                            const locked = e.target.checked;
                                            updateNodeData('locked', locked);
                                            // Also update draggable property
                                            setNodes((nds) =>
                                                nds.map((node) =>
                                                    node.id === selectedNode.id
                                                        ? { ...node, draggable: !locked }
                                                        : node
                                                )
                                            );
                                        }}
                                        className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                    />
                                    <label htmlFor="lockNode" className="text-xs text-slate-400 cursor-pointer">
                                        🔒 Lock Position & Size
                                    </label>
                                </div>

                                {/* Font Size Control */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Font Size</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="range"
                                            min="8"
                                            max="48"
                                            value={selectedNode.data.fontSize || 14}
                                            onChange={(e) => updateNodeData('fontSize', parseInt(e.target.value))}
                                            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <span className="text-xs text-slate-300 w-8 text-right">{selectedNode.data.fontSize || 14}px</span>
                                    </div>
                                </div>

                                {selectedNode.type === 'image' && (
                                    <>
                                        <label className="block text-xs text-slate-400 mb-1">Image URL</label>
                                        <input
                                            type="text"
                                            value={selectedNode.data.url}
                                            onChange={(e) => updateNodeData('url', e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                        />
                                        <label className="block text-xs text-slate-400 mb-1 mt-2">Image Fit</label>
                                        <select
                                            value={selectedNode.data.fit || 'contain'}
                                            onChange={(e) => updateNodeData('fit', e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                        >
                                            <option value="contain">Contain (Fit to Box)</option>
                                            <option value="cover">Cover (Fill Box)</option>
                                            <option value="fill">Fill (Stretch)</option>
                                            <option value="none">None (Original Size)</option>
                                        </select>
                                        <button
                                            onClick={() => {
                                                fileInputRef.current.dataset.nodeId = selectedNode.id;
                                                fileInputRef.current.click();
                                            }}
                                            className="mt-2 w-full bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded text-slate-300"
                                        >
                                            Upload New Image
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {selectedNode.type === 'meter' && (
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Data Type</label>
                                <select
                                    value={selectedNode.data.type}
                                    onChange={(e) => updateNodeData('type', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="kW">Active Power (kW)</option>
                                    <option value="kWh">Energy (kWh)</option>
                                </select>
                                <div className="mt-2 space-y-2">
                                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedNode.data.showLabel !== false}
                                            onChange={(e) => updateNodeData('showLabel', e.target.checked)}
                                            className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        Show Label
                                    </label>
                                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedNode.data.showIcon !== false}
                                            onChange={(e) => updateNodeData('showIcon', e.target.checked)}
                                            className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        Show Icon
                                    </label>
                                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedNode.data.showStatus !== false}
                                            onChange={(e) => updateNodeData('showStatus', e.target.checked)}
                                            className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        Show Status
                                    </label>
                                </div>
                            </div>
                        )}

                        {selectedNode.type === 'carbonCredit' && (
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Time Range</label>
                                <select
                                    value={selectedNode.data.timeRange || 'day'}
                                    onChange={(e) => updateNodeData('timeRange', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="day">Day (Today)</option>
                                    <option value="week">Week (This Week)</option>
                                    <option value="month">Month (This Month)</option>
                                    <option value="year">Year (This Year)</option>
                                </select>
                            </div>
                        )}

                        {selectedNode.type === 'carbonTrend' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Time Range</label>
                                    <select
                                        value={selectedNode.data.timeRange || 'day'}
                                        onChange={(e) => updateNodeData('timeRange', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="day">Day</option>
                                        <option value="week">Week</option>
                                        <option value="month">Month</option>
                                        <option value="year">Year</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {selectedNode.type === 'energyConsumption' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Select Meter</label>
                                    <div className="w-full">
                                        <Autocomplete
                                            items={meters}
                                            selected={selectedNode.data.meterIds || (selectedNode.data.meterId ? [selectedNode.data.meterId] : [])}
                                            onChange={(newIds) => updateNodeData('meterIds', newIds)}
                                            placeholder="Select meters..."
                                            multiple={true}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Time Range</label>
                                    <select
                                        value={selectedNode.data.timeRange || 'day'}
                                        onChange={(e) => updateNodeData('timeRange', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="day">Day</option>
                                        <option value="week">Week</option>
                                        <option value="month">Month</option>
                                        <option value="year">Year</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {(selectedNode.type === 'totalConsumption' || selectedNode.type === 'peakDemand' || selectedNode.type === 'estimateCost') && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Select Meter</label>
                                    <div className="w-full">
                                        <Autocomplete
                                            items={meters}
                                            selected={selectedNode.data.meterIds || (selectedNode.data.meterId ? [selectedNode.data.meterId] : [])}
                                            onChange={(newIds) => updateNodeData('meterIds', newIds)}
                                            placeholder="Select meters..."
                                            multiple={true}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Time Range</label>
                                    <select
                                        value={selectedNode.data.timeRange || 'day'}
                                        onChange={(e) => updateNodeData('timeRange', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="day">Day (Today)</option>
                                        <option value="week">Week (This Week)</option>
                                        <option value="month">Month (This Month)</option>
                                        <option value="year">Year (This Year)</option>
                                    </select>
                                </div>
                                {selectedNode.type !== 'peakDemand' && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <input
                                            type="checkbox"
                                            id="showComparison"
                                            checked={selectedNode.data.showComparison || false}
                                            onChange={(e) => updateNodeData('showComparison', e.target.checked)}
                                            className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        <label htmlFor="showComparison" className="text-xs text-slate-400 cursor-pointer select-none">
                                            Show Comparison %
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedNode.type === 'realtimeGraph' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Select Meters</label>
                                    <div className="w-full">
                                        <Autocomplete
                                            items={meters}
                                            selected={selectedNode.data.meterIds || []}
                                            onChange={(newIds) => {
                                                updateNodeData('meterIds', newIds);
                                                // Also store corresponding serials for MQTT
                                                const serials = newIds.map(id => {
                                                    const meter = meters.find(m => m.val === id);
                                                    return meter?.serial || meter?.name || String(id);
                                                }).filter(s => s);
                                                updateNodeData('meterSerials', serials);
                                            }}
                                            placeholder="Select meters..."
                                            multiple={true}
                                        />
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-1 text-right">
                                        {(selectedNode.data.meterIds || []).length} meters selected
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Data Type</label>
                                    <select
                                        value={selectedNode.data.dataType || 'KW'}
                                        onChange={(e) => updateNodeData('dataType', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="KW">kW (Demand)</option>
                                        <option value="KWH">kWh (Energy)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Time Window (Minutes)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="60"
                                        value={selectedNode.data.timeWindow || 5}
                                        onChange={(e) => updateNodeData('timeWindow', parseInt(e.target.value))}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Line Color</label>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="color"
                                            value={selectedNode.data.lineColor || '#ffffff'}
                                            onChange={(e) => updateNodeData('lineColor', e.target.value)}
                                            className="w-10 h-8 rounded cursor-pointer border border-slate-600"
                                        />
                                        <input
                                            type="text"
                                            value={selectedNode.data.lineColor || '#ffffff'}
                                            onChange={(e) => updateNodeData('lineColor', e.target.value)}
                                            onKeyDown={(e) => e.stopPropagation()}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                </div>


                            </div>
                        )}

                        {selectedNode.type === 'energyDistribution' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Chart Type</label>
                                    <select
                                        value={selectedNode.data.chartType || 'bar'}
                                        onChange={(e) => updateNodeData('chartType', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="bar">Bar Chart</option>
                                        <option value="pie">Pie Chart</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Select Meters</label>
                                    <div className="w-full">
                                        <Autocomplete
                                            items={meters}
                                            selected={selectedNode.data.meterIds || []}
                                            onChange={(newIds) => {
                                                updateNodeData('meterIds', newIds);
                                                // Store meter names for display in chart
                                                const names = newIds.map(id => {
                                                    const meter = meters.find(m => m.val === id);
                                                    return { id, name: meter?.name || `Meter ${id}` };
                                                });
                                                updateNodeData('meterNames', names);
                                            }}
                                            placeholder="Select meters..."
                                            multiple={true}
                                        />
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-1 text-right">
                                        {(selectedNode.data.meterIds || []).length} meters selected
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Time Range</label>
                                    <select
                                        value={selectedNode.data.timeRange || 'day'}
                                        onChange={(e) => updateNodeData('timeRange', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="day">Day</option>
                                        <option value="week">Week</option>
                                        <option value="month">Month</option>
                                        <option value="year">Year</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Color Palette</label>
                                    <select
                                        value={selectedNode.data.colorPalette || 'default'}
                                        onChange={(e) => updateNodeData('colorPalette', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value="default">🎨 Default (Blue Mix)</option>
                                        <option value="ocean">🌊 Ocean</option>
                                        <option value="sunset">🌅 Sunset</option>
                                        <option value="forest">🌲 Forest</option>
                                        <option value="berry">🍇 Berry</option>
                                        <option value="candy">🍬 Candy</option>
                                        <option value="earth">🌍 Earth</option>
                                        <option value="neon">💡 Neon</option>
                                        <option value="pastel">🎀 Pastel</option>
                                        <option value="monochrome">⬛ Monochrome</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Unified Styling for All Nodes */}
                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Styling</h4>

                            {/* Background Color */}
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Background Color</label>
                                {/* Transparent option for all nodes */}
                                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer mb-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedNode.data.transparentBackground || false}
                                        onChange={(e) => updateNodeData('transparentBackground', e.target.checked)}
                                        className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                    />
                                    Transparent Background
                                </label>
                                <div className={`flex gap-2 ${selectedNode.data.transparentBackground ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <input
                                        type="color"
                                        value={selectedNode.data.color || '#ffffff'}
                                        onChange={(e) => updateNodeData('color', e.target.value)}
                                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                        disabled={selectedNode.data.transparentBackground}
                                    />
                                    <input
                                        type="text"
                                        value={selectedNode.data.color || '#ffffff'}
                                        onChange={(e) => updateNodeData('color', e.target.value)}
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                        disabled={selectedNode.data.transparentBackground}
                                    />
                                </div>
                            </div>

                            {/* Border Settings */}
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Border Width (px)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="20"
                                    value={selectedNode.data.borderWidth ?? 2}
                                    onChange={(e) => updateNodeData('borderWidth', parseInt(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                />
                            </div>

                            {/* Frame Style - Only for image type */}
                            {selectedNode.type === 'image' && (
                                <div className="mb-2">
                                    <label className="block text-xs text-slate-400 mb-1">Frame Style</label>
                                    <select
                                        value={selectedNode.data.frameStyle || 'solid'}
                                        onChange={(e) => updateNodeData('frameStyle', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                    >
                                        <option value="none">🚫 None (No Border)</option>
                                        <option value="solid">▬ Solid</option>
                                        <option value="dashed">┄ Dashed</option>
                                        <option value="dotted">⋯ Dotted</option>
                                        <option value="double">▭ Double</option>
                                    </select>
                                </div>
                            )}

                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Border Color</label>
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="color"
                                        value={selectedNode.data.borderColor || selectedNode.data.color || '#ffffff'}
                                        onChange={(e) => updateNodeData('borderColor', e.target.value)}
                                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                    />
                                    <div className="flex-1 flex gap-2">
                                        <input
                                            type="text"
                                            value={selectedNode.data.borderColor || selectedNode.data.color || '#ffffff'}
                                            onChange={(e) => updateNodeData('borderColor', e.target.value)}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                        />
                                        <button
                                            onClick={() => updateNodeData('borderColor', selectedNode.data.color)}
                                            className="px-2 py-1 rounded text-xs bg-slate-800 border border-slate-600 text-slate-400 hover:text-white"
                                            title="Match Background"
                                        >
                                            Match
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Label Color - Only for box type */}
                            {selectedNode.type === 'box' && (
                                <div className="mb-2">
                                    <label className="block text-xs text-slate-400 mb-1">Label Color</label>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="color"
                                            value={selectedNode.data.labelColor || '#000000'}
                                            onChange={(e) => updateNodeData('labelColor', e.target.value)}
                                            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                        />
                                        <input
                                            type="text"
                                            value={selectedNode.data.labelColor || '#000000'}
                                            onChange={(e) => updateNodeData('labelColor', e.target.value)}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Gradient Direction</label>
                                <select
                                    value={selectedNode.data.gradientDirection || 'TL-BR'}
                                    onChange={(e) => updateNodeData('gradientDirection', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="TL-BR">Top-Left to Bottom-Right</option>
                                    <option value="TR-BL">Top-Right to Bottom-Left</option>
                                    <option value="BL-TR">Bottom-Left to Top-Right</option>
                                    <option value="BR-TL">Bottom-Right to Top-Left</option>
                                    <option value="TC-BC">Top-Center to Bottom-Center</option>
                                    <option value="BC-TC">Bottom-Center to Top-Center</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Gradient % ({selectedNode.data.gradientPercentage || 50}%)</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={selectedNode.data.gradientPercentage || 50}
                                    onChange={(e) => updateNodeData('gradientPercentage', parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Arrange</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => {
                                        if (!selectedNode) return;
                                        const updatedNode = { ...selectedNode, zIndex: 1000 };
                                        setNodes((nds) => {
                                            const newNodes = nds.filter((n) => n.id !== selectedNode.id);
                                            newNodes.push(updatedNode);
                                            return newNodes;
                                        });
                                        setSelectedNode(updatedNode);
                                    }}
                                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 rounded text-xs transition-colors"
                                >
                                    Bring to Front
                                </button>
                                <button
                                    onClick={() => {
                                        if (!selectedNode) return;
                                        const updatedNode = { ...selectedNode, zIndex: -1 };
                                        setNodes((nds) => {
                                            const newNodes = nds.filter((n) => n.id !== selectedNode.id);
                                            newNodes.unshift(updatedNode);
                                            return newNodes;
                                        });
                                        setSelectedNode(updatedNode);
                                    }}
                                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 rounded text-xs transition-colors"
                                >
                                    Send to Back
                                </button>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            {selectedNode.type === 'box' && (
                                <button
                                    onClick={() => {
                                        setDefaultBoxStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage
                                        });
                                        alert("Default box style updated! New boxes will use this style.");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'meter' && (
                                <button
                                    onClick={() => {
                                        setDefaultMeterStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            type: selectedNode.data.type,
                                            showLabel: selectedNode.data.showLabel !== false,
                                            showIcon: selectedNode.data.showIcon !== false,
                                            showStatus: selectedNode.data.showStatus !== false
                                        });
                                        alert("Default meter style updated! New meters will use this style.");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'carbonCredit' && (
                                <button
                                    onClick={() => {
                                        setDefaultCarbonCreditStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            timeRange: selectedNode.data.timeRange
                                        });
                                        alert("Default Carbon Credit style updated!");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'carbonTrend' && (
                                <button
                                    onClick={() => {
                                        setDefaultCarbonTrendStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            timeRange: selectedNode.data.timeRange
                                        });
                                        alert("Default Carbon Trend style updated!");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'energyConsumption' && (
                                <button
                                    onClick={() => {
                                        setDefaultEnergyConsumptionStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            timeRange: selectedNode.data.timeRange
                                        });
                                        alert("Default Energy Consumption style updated!");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {(selectedNode.type === 'totalConsumption' || selectedNode.type === 'peakDemand' || selectedNode.type === 'estimateCost') && (
                                <button
                                    onClick={() => {
                                        setDefaultAnalysisStyle(prev => ({
                                            ...prev,
                                            [selectedNode.type]: {
                                                color: selectedNode.data.color,
                                                gradientDirection: selectedNode.data.gradientDirection,
                                                gradientPercentage: selectedNode.data.gradientPercentage,
                                                timeRange: selectedNode.data.timeRange
                                            }
                                        }));
                                        alert(`Default ${selectedNode.data.label} style updated!`);
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'realtimeGraph' && (
                                <button
                                    onClick={() => {
                                        setDefaultRealtimeGraphStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            timeWindow: selectedNode.data.timeWindow,
                                            dataType: selectedNode.data.dataType
                                        });
                                        alert("Default style saved!");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}
                            {selectedNode.type === 'energyDistribution' && (
                                <button
                                    onClick={() => {
                                        setDefaultEnergyDistributionStyle({
                                            color: selectedNode.data.color,
                                            gradientDirection: selectedNode.data.gradientDirection,
                                            gradientPercentage: selectedNode.data.gradientPercentage,
                                            timeRange: selectedNode.data.timeRange,
                                            chartType: selectedNode.data.chartType
                                        });
                                        alert("Default style saved!");
                                    }}
                                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                                >
                                    <Settings size={14} /> Set as Default
                                </button>
                            )}

                            <button
                                onClick={() => {
                                    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                                    setSelectedNode(null);
                                }}
                                className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                                <Trash2 size={14} /> Delete Node
                            </button>
                        </div>
                    </>
                ) : selectedEdge ? (
                    <div className="space-y-4">
                        <h3 className="font-bold mb-4 flex items-center gap-2 text-white">
                            <Settings size={18} className="text-blue-400" />
                            Properties
                        </h3>
                        <div className="text-xs text-slate-400 mb-2">Selected Connection</div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Stroke Width (px)</label>
                            <input
                                type="number"
                                value={selectedEdge.style?.strokeWidth || 1}
                                onChange={(e) => updateEdgeStyle('strokeWidth', parseInt(e.target.value))}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Styling</h4>

                            {/* Background Color (Stroke) */}
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Background Color</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        value={selectedEdge.style?.stroke || '#b1b1b7'}
                                        onChange={(e) => updateEdgeStyle('stroke', e.target.value)}
                                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                    />
                                    <input
                                        type="text"
                                        value={selectedEdge.style?.stroke || '#b1b1b7'}
                                        onChange={(e) => updateEdgeStyle('stroke', e.target.value)}
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                    />
                                </div>
                            </div>

                            {/* Border Settings */}
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Border Width (px)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="20"
                                    value={selectedEdge.data?.borderWidth || 0}
                                    onChange={(e) => updateEdgeData('borderWidth', parseInt(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                />
                            </div>

                            {selectedEdge.data?.borderWidth > 0 && (
                                <div className="mb-2">
                                    <label className="block text-xs text-slate-400 mb-1">Border Color</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={selectedEdge.data?.borderColor || '#000000'}
                                            onChange={(e) => updateEdgeData('borderColor', e.target.value)}
                                            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                                        />
                                        <input
                                            type="text"
                                            value={selectedEdge.data?.borderColor || '#000000'}
                                            onChange={(e) => updateEdgeData('borderColor', e.target.value)}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Gradient Settings */}
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Gradient Direction</label>
                                <select
                                    value={selectedEdge.data?.gradientDirection || 'TL-BR'}
                                    onChange={(e) => updateEdgeData('gradientDirection', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="TL-BR">Top-Left to Bottom-Right</option>
                                    <option value="TR-BL">Top-Right to Bottom-Left</option>
                                    <option value="BL-TR">Bottom-Left to Top-Right</option>
                                    <option value="BR-TL">Bottom-Right to Top-Left</option>
                                    <option value="TC-BC">Top-Center to Bottom-Center</option>
                                    <option value="BC-TC">Bottom-Center to Top-Center</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Gradient % ({selectedEdge.data?.gradientPercentage || 0}%)</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={selectedEdge.data?.gradientPercentage || 0}
                                    onChange={(e) => updateEdgeData('gradientPercentage', parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <button
                                onClick={() => {
                                    if (selectedEdge) {
                                        setDefaultEdgeStyle({
                                            stroke: selectedEdge.style?.stroke || '#b1b1b7',
                                            strokeWidth: selectedEdge.style?.strokeWidth || 1,
                                        });
                                        alert("Default connection style updated! New connections will use this style.");
                                    }
                                }}
                                className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors mb-2"
                            >
                                <Settings size={14} /> Set as Default
                            </button>
                            <button
                                onClick={() => {
                                    setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
                                    setSelectedEdge(null);
                                }}
                                className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-400 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                                <Trash2 size={14} /> Delete Connection
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-300 mb-2">Default Edge Settings</h4>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Stroke Width (px)</label>
                            <input
                                type="number"
                                value={defaultEdgeStyle.strokeWidth}
                                onChange={(e) => setDefaultEdgeStyle(prev => ({ ...prev, strokeWidth: parseInt(e.target.value) }))}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Color</label>
                            <input
                                type="color"
                                value={defaultEdgeStyle.stroke}
                                onChange={(e) => setDefaultEdgeStyle(prev => ({ ...prev, stroke: e.target.value }))}
                                className="w-full h-8 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                            />
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Default Box Settings</h4>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Base Color</label>
                                <input
                                    type="color"
                                    value={defaultBoxStyle.color}
                                    onChange={(e) => setDefaultBoxStyle(prev => ({ ...prev, color: e.target.value }))}
                                    className="w-full h-8 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                                />
                            </div>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Gradient Direction</label>
                                <select
                                    value={defaultBoxStyle.gradientDirection}
                                    onChange={(e) => setDefaultBoxStyle(prev => ({ ...prev, gradientDirection: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="TL-BR">Top-Left to Bottom-Right</option>
                                    <option value="TR-BL">Top-Right to Bottom-Left</option>
                                    <option value="BL-TR">Bottom-Left to Top-Right</option>
                                    <option value="BR-TL">Bottom-Right to Top-Left</option>
                                    <option value="TC-BC">Top-Center to Bottom-Center</option>
                                    <option value="BC-TC">Bottom-Center to Top-Center</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Gradient % ({defaultBoxStyle.gradientPercentage}%)</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={defaultBoxStyle.gradientPercentage}
                                    onChange={(e) => setDefaultBoxStyle(prev => ({ ...prev, gradientPercentage: parseInt(e.target.value) }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Default Meter Settings</h4>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Base Color</label>
                                <input
                                    type="color"
                                    value={defaultMeterStyle.color}
                                    onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, color: e.target.value }))}
                                    className="w-full h-8 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                                />
                            </div>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Gradient Direction</label>
                                <select
                                    value={defaultMeterStyle.gradientDirection}
                                    onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, gradientDirection: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="TL-BR">Top-Left to Bottom-Right</option>
                                    <option value="TR-BL">Top-Right to Bottom-Left</option>
                                    <option value="BL-TR">Bottom-Left to Top-Right</option>
                                    <option value="BR-TL">Bottom-Right to Top-Left</option>
                                    <option value="TC-BC">Top-Center to Bottom-Center</option>
                                    <option value="BC-TC">Bottom-Center to Top-Center</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Gradient % ({defaultMeterStyle.gradientPercentage}%)</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={defaultMeterStyle.gradientPercentage}
                                    onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, gradientPercentage: parseInt(e.target.value) }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="mt-2 space-y-2">
                                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={defaultMeterStyle.showLabel}
                                        onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, showLabel: e.target.checked }))}
                                        className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                    />
                                    Show Label
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={defaultMeterStyle.showIcon}
                                        onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, showIcon: e.target.checked }))}
                                        className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                    />
                                    Show Icon
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={defaultMeterStyle.showStatus}
                                        onChange={(e) => setDefaultMeterStyle(prev => ({ ...prev, showStatus: e.target.checked }))}
                                        className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                                    />
                                    Show Status
                                </label>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-700 mt-4">
                            <h4 className="text-xs font-bold text-slate-300 mb-2">Default Image Settings</h4>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Base Color</label>
                                <input
                                    type="color"
                                    value={defaultImageStyle.color}
                                    onChange={(e) => setDefaultImageStyle(prev => ({ ...prev, color: e.target.value }))}
                                    className="w-full h-8 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                                />
                            </div>
                            <div className="mb-2">
                                <label className="block text-xs text-slate-400 mb-1">Gradient Direction</label>
                                <select
                                    value={defaultImageStyle.gradientDirection}
                                    onChange={(e) => setDefaultImageStyle(prev => ({ ...prev, gradientDirection: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="TL-BR">Top-Left to Bottom-Right</option>
                                    <option value="TR-BL">Top-Right to Bottom-Left</option>
                                    <option value="BL-TR">Bottom-Left to Top-Right</option>
                                    <option value="BR-TL">Bottom-Right to Top-Left</option>
                                    <option value="TC-BC">Top-Center to Bottom-Center</option>
                                    <option value="BC-TC">Bottom-Center to Top-Center</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Gradient % ({defaultImageStyle.gradientPercentage}%)</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={defaultImageStyle.gradientPercentage}
                                    onChange={(e) => setDefaultImageStyle(prev => ({ ...prev, gradientPercentage: parseInt(e.target.value) }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div >
        </div >
    );
};
export default CustomView;
