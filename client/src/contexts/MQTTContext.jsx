import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { useConfig } from './ConfigContext';

const MQTTContext = createContext(null);

export const useMQTT = () => {
    const context = useContext(MQTTContext);
    if (!context) {
        throw new Error('useMQTT must be used within MQTTProvider');
    }
    return context;
};

export const MQTTProvider = ({ children }) => {
    const { mqttUrl, mqttOptions, loading: configLoading } = useConfig();
    const [isConnected, setIsConnected] = useState(false);
    const [data, setData] = useState({}); // Map of serial -> latest data
    const clientRef = useRef(null);
    const subscriptionsRef = useRef(new Set()); // Track active subscriptions
    const initializedRef = useRef(false); // Prevent double init in StrictMode

    useEffect(() => {
        // Wait for config to load
        if (configLoading) {
            console.log("MQTTProvider: Waiting for config to load...");
            return;
        }

        // Prevent double initialization in StrictMode
        if (initializedRef.current) {
            console.log("MQTTProvider: Already initialized, skipping...");
            return;
        }
        initializedRef.current = true;

        // Connect to MQTT once
        console.log("MQTTProvider: Connecting to MQTT at:", mqttUrl);
        const client = mqtt.connect(mqttUrl, mqttOptions);
        clientRef.current = client;

        client.on("connect", () => {
            console.log("MQTTProvider: MQTT Connected to", mqttUrl);
            setIsConnected(true);

            // Re-subscribe to any existing subscriptions after reconnect
            subscriptionsRef.current.forEach(serial => {
                const topic = `SmartEE/Cloud/Device/+/${serial.toUpperCase()}`;
                client.subscribe(topic, { qos: 0 });
            });
        });

        client.on("reconnect", () => {
            console.log("MQTTProvider: Reconnecting...");
        });

        client.on("offline", () => {
            console.log("MQTTProvider: Offline");
            setIsConnected(false);
        });

        client.on("error", (err) => {
            console.error("MQTTProvider: Error", err);
        });

        client.on("close", () => {
            console.log("MQTTProvider: Disconnected");
            setIsConnected(false);
        });

        client.on("message", (topic, message) => {
            try {
                const payload = message.toString();
                const cleanPayload = payload.replace(/NaN/g, '0').replace(/Infinity/g, '0');
                const obj = JSON.parse(cleanPayload);
                const topicSerial = topic.split("/").pop(); // Get serial from topic

                setData(prev => ({
                    ...prev,
                    [topicSerial.toUpperCase()]: {
                        ...obj,
                        lastUpdate: new Date().toISOString()
                    }
                }));
            } catch (err) {
                console.error("MQTTProvider: Error parsing message", err);
            }
        });

        // Cleanup on unmount - but don't cleanup if this was the StrictMode first mount
        // In StrictMode, React mounts, unmounts, then mounts again
        // We skip cleanup on the first unmount by checking if client is still connecting
        return () => {
            // Don't cleanup - this is a persistent connection that should live for the app lifetime
            // The cleanup in StrictMode would break the connection
            // Real cleanup happens when the window closes
            console.log("MQTTProvider: Cleanup called (but keeping connection alive)");
        };
    }, [configLoading, mqttUrl, mqttOptions]);

    // Subscribe to a serial
    const subscribe = useCallback((serial) => {
        if (!serial) return;
        const upperSerial = String(serial).toUpperCase();

        // Always add to subscriptions set
        subscriptionsRef.current.add(upperSerial);
        console.log(`MQTTProvider: Adding ${upperSerial} to subscriptions list`);

        // Subscribe if connected
        if (clientRef.current && clientRef.current.connected) {
            const topic = `SmartEE/Cloud/Device/+/${upperSerial}`;
            clientRef.current.subscribe(topic, { qos: 0 }, (err) => {
                if (err) console.error(`Failed to subscribe to ${topic}`, err);
                else console.log(`MQTTProvider: Subscribed to ${topic}`);
            });
        } else {
            console.log(`MQTTProvider: Not connected yet, ${upperSerial} will be subscribed on connect`);
        }
    }, []);

    // Unsubscribe from a serial
    const unsubscribe = useCallback((serial) => {
        if (!serial) return;
        const upperSerial = String(serial).toUpperCase();

        subscriptionsRef.current.delete(upperSerial);

        if (clientRef.current && clientRef.current.connected) {
            const topic = `SmartEE/Cloud/Device/+/${upperSerial}`;
            clientRef.current.unsubscribe(topic, (err) => {
                if (err) console.error(`Failed to unsubscribe from ${topic}`, err);
                else console.log(`MQTTProvider: Unsubscribed from ${topic}`);
            });
        }
    }, []);

    // Get data for a specific serial
    const getData = useCallback((serial) => {
        if (!serial) return null;
        return data[String(serial).toUpperCase()] || null;
    }, [data]);

    const value = {
        isConnected,
        subscribe,
        unsubscribe,
        getData,
        data,
        mqttUrl // Expose current MQTT URL for debugging
    };

    return (
        <MQTTContext.Provider value={value}>
            {children}
        </MQTTContext.Provider>
    );
};

export default MQTTContext;
