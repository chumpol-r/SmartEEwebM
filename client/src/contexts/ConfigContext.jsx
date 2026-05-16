import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const ConfigContext = createContext(null);

// Default configuration (fallback if config file fails to load)
const DEFAULT_CONFIG = {
    api: {
        baseUrl: ''  // Empty = use relative URLs (same origin)
    },
    mqtt: {
        mode: 'cloud',
        cloudUrl: 'wss://cloudtat.com:9001/mqtt',
        onsiteUrl: 'ws://localhost:9001/mqtt',
        options: {
            keepalive: 30,
            username: 'tatcloudweb',
            password: 'nbpjfdt9',
            reconnectPeriod: 1000,
            connectTimeout: 30000
        }
    }
};

export const ConfigProvider = ({ children }) => {
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                // Load config from public folder
                const response = await fetch('/config/app-config.json');
                if (!response.ok) {
                    throw new Error(`Failed to load config: ${response.status}`);
                }
                const loadedConfig = await response.json();

                // Merge with defaults to ensure all required fields exist
                const mergedConfig = {
                    ...DEFAULT_CONFIG,
                    ...loadedConfig,
                    api: {
                        ...DEFAULT_CONFIG.api,
                        ...(loadedConfig.api || {})
                    },
                    mqtt: {
                        ...DEFAULT_CONFIG.mqtt,
                        ...(loadedConfig.mqtt || {}),
                        options: {
                            ...DEFAULT_CONFIG.mqtt.options,
                            ...(loadedConfig.mqtt?.options || {})
                        }
                    }
                };

                setConfig(mergedConfig);

                // Log only non-sensitive config info
                const mqttUrl = mergedConfig.mqtt.mode === 'onsite'
                    ? mergedConfig.mqtt.onsiteUrl
                    : mergedConfig.mqtt.cloudUrl;
                console.log('Config loaded:', {
                    apiBaseUrl: mergedConfig.api.baseUrl || '(relative)',
                    mqttUrl: mqttUrl,
                    mqttMode: mergedConfig.mqtt.mode
                });

                // Set axios base URL from config
                if (mergedConfig.api.baseUrl) {
                    axios.defaults.baseURL = mergedConfig.api.baseUrl;
                }

            } catch (err) {
                console.warn('Failed to load config, using defaults:', err.message);
                setError(err);
                // Keep using DEFAULT_CONFIG
            } finally {
                setLoading(false);
            }
        };

        loadConfig();
    }, []);

    // Get the active MQTT URL based on mode
    const getMqttUrl = () => {
        const { mode, cloudUrl, onsiteUrl } = config.mqtt;
        return mode === 'onsite' ? onsiteUrl : cloudUrl;
    };

    // Get MQTT connection options
    const getMqttOptions = () => {
        return {
            keepalive: config.mqtt.options.keepalive,
            clientId: 'mqtt_' + Math.random().toString(16).substring(2, 10),
            username: config.mqtt.options.username,
            password: config.mqtt.options.password,
            protocolId: 'MQTT',
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: config.mqtt.options.reconnectPeriod,
            connectTimeout: config.mqtt.options.connectTimeout,
            rejectUnauthorized: false
        };
    };

    // Get API base URL
    const getApiBaseUrl = () => {
        return config.api.baseUrl || '';
    };

    const value = {
        config,
        loading,
        error,
        apiBaseUrl: getApiBaseUrl(),
        mqttUrl: getMqttUrl(),
        mqttOptions: getMqttOptions(),
        isCloudMode: config.mqtt.mode === 'cloud',
        isOnsiteMode: config.mqtt.mode === 'onsite'
    };

    // Show loading screen while config is loading to prevent API calls before baseURL is set
    if (loading) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: '#0f172a',
                color: '#94a3b8',
                fontSize: '1rem'
            }}>
                Loading configuration...
            </div>
        );
    }

    return (
        <ConfigContext.Provider value={value}>
            {children}
        </ConfigContext.Provider>
    );
};

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within a ConfigProvider');
    }
    return context;
};

export default ConfigContext;
