import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Autocomplete from '../components/Autocomplete';
import { Zap, Activity, Clock, Wifi, WifiOff } from 'lucide-react';
import MeterCard from '../components/MeterCard';
import CompareCustomModal from '../components/CompareCustomModal';
import mqtt from 'mqtt';
import { useConfig } from '../contexts/ConfigContext';

const Realtime = () => {
    const { mqttUrl, mqttOptions: configMqttOptions, loading: configLoading } = useConfig();
    const [meters, setMeters] = useState([]);
    const [selectedMeters, setSelectedMeters] = useState([]); // Array of Serial IDs
    const [data, setData] = useState({}); // Map of serial -> data object
    const [loading, setLoading] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    const [selectedMetrics, setSelectedMetrics] = useState([]);
    const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

    const clientRef = useRef(null);
    const meterMapRef = useRef({}); // Map UpperCase Serial -> Original Serial

    // MQTT Options (using config values)
    const MQTT_OPTIONS = {
        ...configMqttOptions,
        clientId: "mqttany_" + Math.random().toString(16),
    };

    const [initialized, setInitialized] = useState(false);

    // Fetch Meters
    useEffect(() => {
        const fetchMeters = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('/api/meters', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                // Process meters to match legacy logic:
                // 1. Use 'serial' column if available, otherwise 'val'
                // 2. Strip 'Domain\' prefix if present
                const processedMeters = res.data.map(m => {
                    let serial = m.serial || m.val;
                    if (typeof serial === 'string' && serial.includes('\\')) {
                        serial = serial.split('\\')[1];
                    }
                    return {
                        ...m,
                        val: serial, // Use cleaned serial as the value
                        originalId: m.val
                    };
                });

                setMeters(processedMeters);

                // Update the map for case-insensitive lookup
                const map = {};
                processedMeters.forEach(m => {
                    if (m.val) map[String(m.val).toUpperCase()] = m.val;
                });
                meterMapRef.current = map;

                // Load from localStorage or default
                const saved = localStorage.getItem('realtime_meters');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        // Map saved IDs to actual values in processedMeters to ensure type consistency
                        const validMeters = parsed.map(id => {
                            const found = processedMeters.find(m => String(m.val) === String(id));
                            return found ? found.val : null;
                        }).filter(val => val !== null);

                        if (validMeters.length > 0) {
                            setSelectedMeters(validMeters);
                        } else if (processedMeters.length > 0) {
                            setSelectedMeters(processedMeters.slice(0, 3).map(m => m.val));
                        }
                    } catch (e) {
                        console.error("Failed to parse saved meters", e);
                        if (processedMeters.length > 0) {
                            setSelectedMeters(processedMeters.slice(0, 3).map(m => m.val));
                        }
                    }
                } else if (processedMeters.length > 0) {
                    setSelectedMeters(processedMeters.slice(0, 3).map(m => m.val));
                }
            } catch (err) {
                console.error("Failed to fetch meters", err);
            } finally {
                setInitialized(true);
            }
        };
        fetchMeters();
    }, []);

    // Persist selection
    useEffect(() => {
        if (initialized) {
            localStorage.setItem('realtime_meters', JSON.stringify(selectedMeters));
        }
    }, [selectedMeters, initialized]);

    const extractFirstJsonObject = (text) => {
        const start = text.indexOf('{');
        if (start === -1) {
            throw new Error('No JSON object found in payload');
        }

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
                continue;
            }

            if (ch === '{') {
                depth += 1;
                continue;
            }

            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(start, i + 1);
                }
            }
        }

        throw new Error('Incomplete JSON object in payload');
    };

    // MQTT Connection & Subscription
    useEffect(() => {
        if (selectedMeters.length === 0) {
            if (clientRef.current) {
                clientRef.current.end();
                clientRef.current = null;
                setIsConnected(false);
            }
            return;
        }

        // Connect if not connected
        if (!clientRef.current && !configLoading) {
            console.log("Connecting to MQTT at:", mqttUrl);
            const client = mqtt.connect(mqttUrl, MQTT_OPTIONS);
            clientRef.current = client;

            client.on("connect", () => {
                console.log("MQTT Connected");
                setIsConnected(true);
                subscribeToMeters(client, selectedMeters);
            });

            client.on("reconnect", () => {
                console.log("MQTT Reconnecting...");
            });

            client.on("offline", () => {
                console.log("MQTT Offline");
                setIsConnected(false);
            });

            client.on("error", (err) => {
                console.error("MQTT Error:", err);
                // Don't necessarily set disconnected on error, wait for close/offline
            });

            client.on("close", () => {
                console.log("MQTT Disconnected");
                setIsConnected(false);
            });

            client.on("message", (topic, message) => {
                // If we are receiving messages, we are definitely connected!
                // This acts as a safety net for the UI state
                setIsConnected(true);

                try {
                    const payload = message.toString();

                    const cleanPayload = payload
                        .replace(/\bNaN\b/g, '0')
                        .replace(/\b-?Infinity\b/g, '0');

                    const jsonPayload = extractFirstJsonObject(cleanPayload);
                    const obj = JSON.parse(jsonPayload);

                    const topicSerial = topic.split("/").pop(); // Get serial from topic (likely Uppercase)

                    // Resolve the original serial key using the map
                    // This handles case mismatch (e.g. Topic: "ABC", DB: "abc")
                    const originalSerial = meterMapRef.current[topicSerial.toUpperCase()] || topicSerial;

                    setData(prev => ({
                        ...prev,
                        [originalSerial]: {
                            ...obj,
                            lastUpdate: new Date().toISOString()
                        }
                    }));
                } catch (err) {
                    console.error("Error parsing MQTT message:", err);
                }
            });
        } else {
            // If already connected, just update subscriptions
            if (clientRef.current.connected) {
                subscribeToMeters(clientRef.current, selectedMeters);
            }
        }

        return () => {
            // Cleanup on unmount
            if (clientRef.current) {
                clientRef.current.end();
                clientRef.current = null;
            }
        };
    }, [selectedMeters]);

    const subscribeToMeters = (client, metersToSubscribe) => {
        // Unsubscribe from all first (simple approach, or track active subscriptions)
        // client.unsubscribe('#'); 

        metersToSubscribe.forEach(serial => {
            if (serial) {
                const topic = `SmartEE/Cloud/Device/+/${serial.toUpperCase()}`;
                client.subscribe(topic, { qos: 0 }, (err) => {
                    if (err) console.error(`Failed to subscribe to ${topic}`, err);
                    else console.log(`Subscribed to ${topic}`);
                });
            }
        });
    };

    // Helper to format numbers safely
    const fmt = (val, dec = 2) => {
        if (val === undefined || val === null || val === '') return "--";
        const num = Number(val);
        if (isNaN(num)) return "--";
        return num.toFixed(dec);
    };

    const handleToggleMetric = (serialID, originalId, meterName, metricData) => {
        if (!metricData || !metricData.dbKey) return;
        
        setSelectedMetrics(prev => {
            const exists = prev.find(m => m.serial === serialID && m.dbKey === metricData.dbKey);
            if (exists) {
                return prev.filter(m => !(m.serial === serialID && m.dbKey === metricData.dbKey));
            } else {
                return [...prev, {
                    serial: serialID,
                    meterId: originalId || serialID, // use numeric DB ID if possible
                    meterName: meterName,
                    dbKey: metricData.dbKey,
                    label: metricData.label,
                    unit: metricData.unit,
                    color: metricData.color
                }];
            }
        });
    };

    return (
        <>
        <div className="space-y-6 max-w-7xl mx-auto p-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Activity className="text-blue-400" /> Realtime Monitoring
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                        {!isConnected ? (
                            <span className="text-red-400 text-sm flex items-center gap-1"><WifiOff size={14} /> Disconnected</span>
                        ) : Object.keys(data).length === 0 ? (
                            <span className="text-yellow-400 text-sm flex items-center gap-1 animate-pulse"><Wifi size={14} /> Connecting...</span>
                        ) : (
                            <span className="text-green-400 text-sm flex items-center gap-1"><Wifi size={14} /> MQTT Connected</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <span className="text-sm text-slate-400 whitespace-nowrap">Select Meters:</span>
                    <div className="w-full md:w-96">
                        <Autocomplete
                            items={meters}
                            selected={selectedMeters}
                            onChange={setSelectedMeters}
                            placeholder="Search machines..."
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {selectedMeters.map((serial) => {
                    const machineData = data[serial] || {};
                    const meterInfo = meters.find(m => m.val === serial);
                    const name = meterInfo ? (meterInfo.displayName || meterInfo.name) : serial;
                    const hasData = !!machineData.Time;

                    return (
                            <MeterCard
                                key={serial}
                                name={name}
                                hasData={hasData}
                                isConnected={isConnected}
                                machineData={machineData}
                                fmt={fmt}
                                selectedMetrics={selectedMetrics.filter(m => m.serial === serial)}
                                onToggleMetric={(metricData) => handleToggleMetric(serial, meterInfo?.originalId, name, metricData)}
                            />
                        );
                    })}

                    {selectedMeters.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-500 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                            <Activity size={48} className="mb-4 opacity-50" />
                            <p className="text-lg">No meters selected</p>
                            <p className="text-sm">Search and select meters above to view realtime data</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Comparison Action Bar */}
            {selectedMetrics.length > 0 && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-slate-800 border border-slate-600 shadow-[0_10px_30px_rgba(59,130,246,0.3)] rounded-full px-6 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-5">
                    <span className="text-white font-medium whitespace-nowrap">
                        {selectedMetrics.length} variable{selectedMetrics.length > 1 ? 's' : ''} selected
                    </span>
                    <div className="h-5 w-px bg-slate-600"></div>
                    <button 
                        onClick={() => setSelectedMetrics([])}
                        className="text-slate-400 hover:text-white transition-colors text-sm font-medium"
                    >
                        Clear
                    </button>
                    <button 
                        onClick={() => setIsCompareModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                        <Activity size={16} /> View History
                    </button>
                </div>
            )}

            {/* Comparison Modal */}
            <CompareCustomModal 
                isOpen={isCompareModalOpen}
                onClose={() => setIsCompareModalOpen(false)}
                selectedMetrics={selectedMetrics}
                onToggleMetric={(metricData, serial, meterId, meterName) => handleToggleMetric(serial, meterId, meterName, metricData)}
            />
        </>
    );
};

export default Realtime;
