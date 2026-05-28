import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const ConfigContext = createContext(null);

// Fallback used when both the JSON file and the server endpoint are
// unavailable. Kept intentionally identical to the legacy values so an
// uncontrolled outage still leaves the dev environment usable.
const DEFAULT_CONFIG = {
    api: {
        baseUrl: ''  // Empty = use relative URLs (same origin)
    },
    system: {
        baseUrl: ''  // Absolute site URL (QR codes, share links). Empty = fall back to window.location.origin at call site.
    },
    mqtt: {
        mode: 'cloud',
        cloudUrl: 'wss://cloudtat.com:9001/mqtt',
        onsiteUrl: 'ws://localhost:9001/mqtt',
        options: {
            keepalive: 30,
            username: '',
            password: '',
            reconnectPeriod: 1000,
            connectTimeout: 30000
        }
    }
};

// Two-stage config:
//   Stage 1 (always) — fetch /config/app-config.json for public values
//                       (mode, urls, api.baseUrl). NO credentials live there.
//   Stage 2 (only when logged in) — fetch /api/mqtt/config with the token
//                       to receive the MQTT broker username/password.
// Until Stage 2 succeeds the MQTT options carry empty credentials, so MQTT
// connections from the page either fail fast or are deferred — either way,
// anonymous visitors can't extract the broker login.
export const ConfigProvider = ({ children }) => {
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadPublicConfig = useCallback(async () => {
        try {
            const response = await fetch('/config/app-config.json');
            if (!response.ok) throw new Error(`Failed to load config: ${response.status}`);
            const loaded = await response.json();
            return {
                ...DEFAULT_CONFIG,
                ...loaded,
                api:    { ...DEFAULT_CONFIG.api,    ...(loaded.api    || {}) },
                system: { ...DEFAULT_CONFIG.system, ...(loaded.system || {}) },
                mqtt: {
                    ...DEFAULT_CONFIG.mqtt,
                    ...(loaded.mqtt || {}),
                    options: {
                        ...DEFAULT_CONFIG.mqtt.options,
                        ...(loaded.mqtt?.options || {}),
                    },
                },
            };
        } catch (err) {
            console.warn('Failed to load /config/app-config.json, using defaults:', err.message);
            return DEFAULT_CONFIG;
        }
    }, []);

    // Pull MQTT credentials from the authenticated endpoint. Returns null when
    // there's no token (visitor is signed out) or the call fails so callers
    // can choose to keep whatever creds they already have.
    const loadMqttCredentials = useCallback(async () => {
        const token = localStorage.getItem('token');
        if (!token) return null;
        try {
            const res = await axios.get('/api/mqtt/config', {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.data?.success ? res.data : null;
        } catch (err) {
            console.warn('Failed to load MQTT credentials from server:', err.response?.status || err.message);
            return null;
        }
    }, []);

    const refresh = useCallback(async () => {
        const publicCfg = await loadPublicConfig();
        const remote = await loadMqttCredentials();

        const merged = remote
            ? {
                ...publicCfg,
                mqtt: {
                    ...publicCfg.mqtt,
                    mode:      remote.mode      ?? publicCfg.mqtt.mode,
                    cloudUrl:  remote.cloudUrl  ?? publicCfg.mqtt.cloudUrl,
                    onsiteUrl: remote.onsiteUrl ?? publicCfg.mqtt.onsiteUrl,
                    options: {
                        ...publicCfg.mqtt.options,
                        ...(remote.options || {}),
                    },
                },
            }
            : publicCfg;

        setConfig(merged);

        if (merged.api.baseUrl) {
            axios.defaults.baseURL = merged.api.baseUrl;
        }
        const mqttUrl = merged.mqtt.mode === 'onsite'
            ? merged.mqtt.onsiteUrl
            : merged.mqtt.cloudUrl;
        console.log('Config loaded:', {
            apiBaseUrl: merged.api.baseUrl || '(relative)',
            mqttUrl,
            mqttMode: merged.mqtt.mode,
            mqttCredsLoaded: !!(remote && remote.options?.username),
        });
    }, [loadPublicConfig, loadMqttCredentials]);

    useEffect(() => {
        (async () => {
            try { await refresh(); }
            catch (err) { setError(err); }
            finally { setLoading(false); }
        })();

        // Re-fetch MQTT credentials whenever the user logs in / out — Login.jsx
        // and Profile.jsx already dispatch this event, so the credentials
        // appear in MQTTContext within the same tick the token arrives.
        const onUserChange = () => { refresh(); };
        window.addEventListener('userUpdated', onUserChange);
        return () => window.removeEventListener('userUpdated', onUserChange);
    }, [refresh]);

    const getMqttUrl = () => {
        const { mode, cloudUrl, onsiteUrl } = config.mqtt;
        return mode === 'onsite' ? onsiteUrl : cloudUrl;
    };

    const getMqttOptions = () => ({
        keepalive: config.mqtt.options.keepalive,
        clientId: 'mqtt_' + Math.random().toString(16).substring(2, 10),
        username: config.mqtt.options.username,
        password: config.mqtt.options.password,
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: config.mqtt.options.reconnectPeriod,
        connectTimeout: config.mqtt.options.connectTimeout,
        rejectUnauthorized: false,
    });

    const value = {
        config,
        loading,
        error,
        refresh,
        apiBaseUrl: config.api.baseUrl || '',
        systemBaseUrl: config.system?.baseUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
        mqttUrl: getMqttUrl(),
        mqttOptions: getMqttOptions(),
        isCloudMode: config.mqtt.mode === 'cloud',
        isOnsiteMode: config.mqtt.mode === 'onsite',
    };

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
