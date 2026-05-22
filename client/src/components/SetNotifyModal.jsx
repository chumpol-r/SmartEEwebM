import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';

const SetNotifyModal = ({ isOpen, onClose, title = 'Set Notifys', selectedMetrics = [] }) => {
    const [selectedSerial, setSelectedSerial] = useState(null);
    const [notificationSettings, setNotificationSettings] = useState({});
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [showDataPreview, setShowDataPreview] = useState(false);
    const [showSelectedMetricsPreview, setShowSelectedMetricsPreview] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;

        setSelectedSerial(null);
        setNotificationSettings({});
        setShowConfirmation(false);
        setShowDataPreview(false);
        setShowSelectedMetricsPreview(false);

        if (selectedMetrics.length === 0) return;

        const fetchExistingSettings = async () => {
            setIsLoading(true);
            try {
                const serials = [...new Set(selectedMetrics.map(m => m.serial))].join(',');
                const res = await axios.get('/api/notify', { params: { serials } });

                if (!res.data.success) return;

                // map API data กลับเข้า notificationSettings state
                const levelOrder = ['Very Low', 'Low', 'Normal', 'High', 'Very High'];
                const mapped = {};
                res.data.data.forEach(item => {
                    const settingKey = `${item.serial}-${item.dbKey}`;
                    const levelIndex = levelOrder.indexOf(item.levelName);
                    if (levelIndex === -1) return;
                    if (!mapped[settingKey]) mapped[settingKey] = {};
                    mapped[settingKey][levelIndex] = {
                        point: item.point,
                        delay: item.delay,
                        message: item.message,
                        alarmType: item.alarmType
                    };
                });
                setNotificationSettings(mapped);
            } catch (err) {
                console.error('Failed to load notification settings:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchExistingSettings();
    }, [isOpen]);

    if (!isOpen) return null;

    // Group metrics by serial
    const groupedMetrics = selectedMetrics.reduce((acc, metric) => {
        const serial = metric?.serial || metric?.key || 'Unknown';
        if (!acc[serial]) {
            acc[serial] = [];
        }
        acc[serial].push(metric);
        return acc;
    }, {});

    const groupedEntries = Object.entries(groupedMetrics);

    // Set initial selected serial on first render
    if (selectedSerial === null && groupedEntries.length > 0) {
        setSelectedSerial(groupedEntries[0][0]);
    }

    // Get metrics for selected serial
    const metricsForSelectedSerial = selectedSerial && groupedMetrics[selectedSerial] ? groupedMetrics[selectedSerial] : [];

    // Handle notification setting changes in real-time.
    // The input "name" encodes "serial|dbKey|levelIndex|field".
    const handleChangeData = (e) => {
        const { name, value } = e.target;
        const [serial, metricKey, levelIndexStr, field] = name.split('|');
        const levelIndex = Number(levelIndexStr);

        const metricExists = selectedMetrics.some(m => m.serial === serial && m.dbKey === metricKey);
        if (!metricExists) return;

        setNotificationSettings(prev => {
            const levelNames = ['Very Low', 'Low', 'Normal', 'High', 'Very High'];
            const settingKey = `${serial}-${metricKey}`;
            const defaultMessage = `${levelNames[levelIndex]} Alert`;
            const updatedLevel = {
                ...prev[settingKey]?.[levelIndex],
                [field]: value
            };

            if (field === 'point') {
                if (Number(value) > 0) {
                    if (!updatedLevel.message) updatedLevel.message = defaultMessage;
                } else if (updatedLevel.message === defaultMessage) {
                    updatedLevel.message = '';
                }
            }

            return {
                ...prev,
                [settingKey]: {
                    ...prev[settingKey],
                    [levelIndex]: updatedLevel
                }
            };
        });
    };

    // Prepare data for confirmation and API submission (flat array of settings)
    const prepareConfirmationData = () => {
        const levelNames = ['Very Low', 'Low', 'Normal', 'High', 'Very High'];
        return selectedMetrics.flatMap(metric => {
            const settingKey = `${metric.serial}-${metric.dbKey}`;
            return levelNames
                .map((levelName, levelIndex) => {
                    const levelSettings = notificationSettings[settingKey]?.[levelIndex] || {};
                    const base = {
                        serial: metric.serial,
                        // Canonical MQTT join key = the exact topic serial (uppercased),
                        // so the alert worker can match payloads precisely.
                        mqttSerial: String(metric.serial || '').toUpperCase(),
                        dbKey: metric.dbKey,
                        levelName: levelName,
                        message: levelSettings.message || `${levelName} Alert`,
                        alarmType: levelSettings.alarmType || '',
                        originalId: parseInt(metric.meterId)
                    };
                    if (levelName === 'Normal') {
                        // Normal: Point/Delay fixed (0 / 10). Only submit when an Alarm is chosen.
                        if (!levelSettings.alarmType) return null;
                        return { ...base, point: 0, delay: 10 };
                    }
                    return {
                        ...base,
                        point: Number(levelSettings.point) || 0,
                        delay: Number(levelSettings.delay) || 10
                    };
                })
                // Non-Normal needs point > 0; Normal is always kept (it passed the alarm check above)
                .filter(setting => setting && (setting.levelName === 'Normal' || setting.point > 0));
        });
    };

    // Check if any settings have been modified
    const hasChanges = () => {
        return Object.values(notificationSettings).some(metricSettings =>
            Object.values(metricSettings).some(levelSettings =>
                levelSettings && (levelSettings.point || levelSettings.delay || levelSettings.alarmType)
            )
        );
    };

    // Check if form is valid - Message is required if Point > 0
    const isFormValid = () => {
        if (!hasChanges()) return false;

        // Block submit if any metric's points are out of level-scope order
        if (hasOrderingErrors()) return false;

        return !Object.values(notificationSettings).some(metricSettings =>
            Object.values(metricSettings).some(levelSettings => {
                if (!levelSettings) return false;
                // Message is required if Point > 0
                const pointValue = Number(levelSettings.point);
                return pointValue > 0 && !levelSettings.message;
            })
        );
    };

    // Check if a specific level's message is required but empty
    const isMessageRequired = (metricKey, levelIndex, serial) => {
        const settingKey = `${serial}-${metricKey}`;
        const levelSettings = notificationSettings[settingKey]?.[levelIndex];
        if (!levelSettings) return false;
        const pointValue = Number(levelSettings.point);
        // ถ้า Point > 0 ต้องมี message (default ยอมรับได้)
        return pointValue > 0 && !levelSettings.message;
    };

    // Point ordering by level scope: Very Low < Low < High < Very High.
    // (Normal has no point.) Lower levels guard the lower bound, higher levels
    // the upper bound — so points must increase in this order or the bands overlap.
    // Returns the set of offending level indexes for one metric.
    const ALERT_LEVEL_ORDER = [0, 1, 3, 4]; // Very Low, Low, High, Very High (ascending point)
    const getPointOrderErrors = (serial, metricKey) => {
        const settingKey = `${serial}-${metricKey}`;
        const s = notificationSettings[settingKey] || {};
        const seq = ALERT_LEVEL_ORDER
            .map(i => ({ i, p: Number(s[i]?.point) }))
            .filter(x => x.p > 0);
        const bad = new Set();
        for (let k = 1; k < seq.length; k++) {
            if (seq[k].p <= seq[k - 1].p) {
                bad.add(seq[k].i);
                bad.add(seq[k - 1].i);
            }
        }
        return bad;
    };

    // True if ANY metric has a point-ordering violation
    const hasOrderingErrors = () => {
        return selectedMetrics.some(m => getPointOrderErrors(m.serial, m.dbKey).size > 0);
    };

    const handleConfirmSetNotify = () => {
        if (!hasChanges()) return;
        const confirmData = prepareConfirmationData();
        console.log('Data to send:', confirmData);
        setShowConfirmation(true);
    };

    // Post notifications to API
    const handlePostNotifications = async () => {
        if (!isFormValid() || isLoading) return;
        setIsLoading(true);

        const flattenedData = prepareConfirmationData();

        try {
            await axios.post('/api/notify', flattenedData);
            await new Promise(resolve => setTimeout(resolve, 1500));

            setIsLoading(false);
            setShowConfirmation(false);
            setNotificationSettings({});
            onClose();
        } catch (error) {
            console.error('Error sending data:', error);
            const errorMessage = error.response?.data?.error || error.message || 'Failed to save notification settings';
            alert(`Error: ${errorMessage}`);
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 sticky top-0 z-10 shrink-0">
                    <h2 className="text-xl font-bold text-white">{title}</h2>
                    <button
                        onClick={() => {
                            setNotificationSettings({});
                            setShowConfirmation(false);
                            setShowDataPreview(false);
                            onClose();
                        }}
                        className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Loading overlay when fetching existing settings */}
                {isLoading && (
                    <div className="flex-1 flex items-center justify-center py-20">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                            <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin"></div>
                            <span className="text-sm">กำลังโหลดการตั้งค่า...</span>
                        </div>
                    </div>
                )}

                {/* Serial Navigation Bar */}
                {!isLoading && groupedEntries.length > 0 && (
                    <div className="px-6 py-3 border-b border-slate-700 bg-slate-800/50 flex flex-wrap items-center gap-2">
                        {groupedEntries.map(([serial]) => (
                            <button
                                key={serial}
                                onClick={() => setSelectedSerial(serial)}
                                className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition-colors cursor-pointer ${
                                    selectedSerial === serial
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                            >
                                {serial}
                            </button>
                        ))}
                    </div>
                )}

                {!isLoading && <div className="flex-1 overflow-y-auto p-3 pb-20">
                    {groupedEntries.length > 0 ? (
                        <div className="space-y-4">
                            {/* Serial Header */}
                            {selectedSerial && (
                                <div className="mb-4 pb-3 border-b border-slate-700">
                                    <div className="text-lg font-bold text-blue-400 uppercase tracking-wider">
                                        {selectedSerial}
                                    </div>
                                </div>
                            )}

                            {/* Grid Layout for metrics from selected serial */}
                            <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-1 gap-3">
                                {metricsForSelectedSerial.map((metric, metricIdx) => (
                                    <div
                                        key={`${selectedSerial}-${metricIdx}`}
                                        className="bg-slate-800/60 border border-slate-700 rounded-lg p-2.5 hover:border-slate-600 transition-colors"
                                    >
                                        {/* Metric Label */}
                                        <div className="mb-3 pb-2">
                                            <div className="text-sm font-semibold text-slate-200 pl-2 border-l-2 border-slate-600">
                                                {metric?.label || metric?.dbKey || 'Unnamed'}
                                            </div>
                                        </div>

                                        {/* Compact Settings Table */}
                                        <form onSubmit={(e) => e.preventDefault()} className="bg-slate-900 rounded border border-slate-700 text-xs overflow-hidden">
                                            {/* Minimal Header */}
                                            <div className="grid grid-cols-5 gap-1 p-1.5 bg-slate-800 border-b border-slate-700 font-medium text-slate-300">
                                                <div>Level</div>
                                                <div>Point</div>
                                                <div>Delay</div>
                                                <div>Message</div>
                                                <div>Alarm</div>
                                            </div>

                                            {/* Settings Rows — displayed Very High (top) -> Very Low (bottom).
                                                levelIndex keeps the stored mapping stable regardless of display order. */}
                                            {[
                                                { level: 'Very High', short: 'VH', color: 'text-red-500', levelIndex: 4 },
                                                { level: 'High', short: 'H', color: 'text-yellow-400', levelIndex: 3 },
                                                { level: 'Normal', short: 'N', color: 'text-green-400', levelIndex: 2 },
                                                { level: 'Low', short: 'L', color: 'text-red-400', levelIndex: 1 },
                                                { level: 'Very Low', short: 'VL', color: 'text-red-600', levelIndex: 0 }
                                            ].map((row) => {
                                                const idx = row.levelIndex;
                                                const metricKey = metric.dbKey;
                                                const settingKey = `${metric.serial}-${metricKey}`;
                                                const currentValue = notificationSettings[settingKey]?.[idx] || {};

                                                // Normal: Point/Delay are fixed (shown as "—"); only Message + Alarm are editable.
                                                if (row.level === 'Normal') {
                                                    return (
                                                        <div key={`${metricKey}-${idx}`} className={`grid grid-cols-5 gap-1 p-1.5 border-b border-slate-700 last:border-b-0 items-center border-l-2 ${row.color}`}>
                                                            <div className="text-xs font-semibold truncate">{row.level}</div>
                                                            <div className="text-xs text-slate-500 text-center">—</div>
                                                            <div className="text-xs text-slate-500 text-center">—</div>
                                                            <input
                                                                type="text"
                                                                name={`${metric.serial}|${metricKey}|${idx}|message`}
                                                                value={currentValue.message !== undefined ? currentValue.message : `${row.level} Alert`}
                                                                onChange={handleChangeData}
                                                                className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                                                            />
                                                            <select
                                                                name={`${metric.serial}|${metricKey}|${idx}|alarmType`}
                                                                value={currentValue.alarmType || ''}
                                                                onChange={handleChangeData}
                                                                className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                                                            >
                                                                <option value="">Select...</option>
                                                                <option value="Dialog">Dialog</option>
                                                                <option value="Email">Email</option>
                                                                <option value="SMS">SMS</option>
                                                            </select>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={`${metricKey}-${idx}`} className={`grid grid-cols-5 gap-1 p-1.5 border-b border-slate-700 last:border-b-0 items-center border-l-2 ${row.color}`}>
                                                        <div className="text-xs font-semibold truncate">{row.level}</div>
                                                        <input
                                                            type="number"
                                                            name={`${metric.serial}|${metricKey}|${idx}|point`}
                                                            placeholder="0.00"
                                                            value={currentValue.point !== undefined ? currentValue.point : 0.0}
                                                            onChange={handleChangeData}
                                                            step="0.01"
                                                            title={getPointOrderErrors(metric.serial, metricKey).has(idx)
                                                                ? 'Point ต้องเรียง: Very Low < Low < High < Very High'
                                                                : undefined}
                                                            className={`bg-slate-800 rounded px-1 py-0.5 text-xs text-white focus:outline-none ${
                                                                getPointOrderErrors(metric.serial, metricKey).has(idx)
                                                                    ? 'border border-red-500 focus:border-red-400'
                                                                    : 'border border-slate-600 focus:border-blue-500'
                                                            }`}
                                                        />
                                                        <input
                                                            type="number"
                                                            name={`${metric.serial}|${metricKey}|${idx}|delay`}
                                                            placeholder="10"
                                                            value={currentValue.delay !== undefined ? currentValue.delay : 10}
                                                            onChange={handleChangeData}
                                                            className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                                                        />
                                                        <input
                                                            type="text"
                                                            name={`${metric.serial}|${metricKey}|${idx}|message`}
                                                            value={currentValue.message !== undefined ? currentValue.message : `${row.level} Alert`}
                                                            onChange={handleChangeData}
                                                            className={`bg-slate-800 rounded px-1 py-0.5 text-xs text-white focus:outline-none ${
                                                                isMessageRequired(metricKey, idx, metric.serial)
                                                                    ? 'border border-red-500 focus:border-red-400'
                                                                    : 'border border-slate-600 focus:border-blue-500'
                                                            }`}
                                                        />
                                                        <select
                                                            name={`${metric.serial}|${metricKey}|${idx}|alarmType`}
                                                            value={currentValue.alarmType || ''}
                                                            onChange={handleChangeData}
                                                            disabled={!(Number(currentValue.point) > 0)}
                                                            className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            <option value="">Select...</option>
                                                            <option value="Dialog">Dialog</option>
                                                            <option value="Email">Email</option>
                                                            <option value="SMS">SMS</option>
                                                        </select>

                                                    </div>
                                                );
                                            })}
                                        </form>

                                        {/* Ordering validation hint */}
                                        {getPointOrderErrors(metric.serial, metric.dbKey).size > 0 && (
                                            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                                                ⚠ Point ต้องเรียงตามระดับ: Very Low &lt; Low &lt; High &lt; Very High
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>

                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center text-slate-400 py-12">
                            <p className="text-base">No metrics selected</p>
                            <p className="text-xs mt-1">กรุณาเลือก metric ก่อนเปิด Set Notify</p>
                        </div>
                    )}
                </div>}

                {/* Confirm Button - Fixed at bottom */}
                {!isLoading && groupedEntries.length > 0 && (
                    <div className="px-6 py-4 border-t border-slate-700 flex justify-end bg-slate-900 z-20">
                        <button
                            onClick={handleConfirmSetNotify}
                            disabled={!isFormValid()}
                            className={`px-6 py-2 rounded-lg font-semibold transition-colors cursor-pointer ${
                                isFormValid()
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                    : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                        >
                            Set Notify
                        </button>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {showConfirmation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 sticky top-0 z-10 shrink-0">
                            <h2 className="text-xl font-bold text-white">ยืนยันการตั้งค่า</h2>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4">
                            <p className="text-slate-300 mb-4">กรุณาตรวจสอบข้อมูลต่อไปนี้ก่อนส่งไป Database:</p>

                            <div className="bg-slate-900 rounded border border-slate-700 text-xs overflow-hidden">
                                <div className="grid grid-cols-6 gap-1 p-1.5 bg-slate-800 border-b border-slate-700 font-medium text-slate-300">
                                    <div>Serial</div>
                                    <div>Metric</div>
                                    <div>Level</div>
                                    <div>Point</div>
                                    <div>Delay</div>
                                    <div>Message</div>
                                </div>

                                {prepareConfirmationData().map((setting, idx) => (
                                    <div key={idx} className="grid grid-cols-6 gap-1 p-1.5 border-b border-slate-700 last:border-b-0 items-center text-slate-300">
                                        <div className="text-xs font-semibold text-blue-400 truncate">{setting.serial}</div>
                                        <div className="text-xs truncate">{setting.dbKey}</div>
                                        <div className="text-xs font-semibold">{setting.levelName}</div>
                                        <div className="text-xs">{setting.point || '-'}</div>
                                        <div className="text-xs">{setting.delay || '-'}</div>
                                        <div className="text-xs truncate">{setting.message || '-'}</div>
                                    </div>
                                ))}
                            </div>

                        </div>

                        <div className="sticky bottom-0 px-6 py-4 border-t border-slate-700 flex justify-end gap-3 bg-slate-900 z-20">
                            <button
                                onClick={() => setShowConfirmation(false)}
                                className="px-4 py-2 rounded-lg font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors cursor-pointer"
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handlePostNotifications}
                                disabled={!isFormValid() || isLoading}
                                className={`px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                                    isLoading
                                        ? 'text-slate-500 bg-slate-700 cursor-not-allowed'
                                        : isFormValid()
                                        ? 'text-white bg-blue-600 hover:bg-blue-500 cursor-pointer'
                                        : 'text-slate-500 bg-slate-700 cursor-not-allowed'
                                }`}
                            >
                                {isLoading && (
                                    <div className="w-4 h-4 border-2 border-slate-400 border-t-blue-400 rounded-full animate-spin"></div>
                                )}
                                {isLoading ? 'Sending...' : 'Confirm & Submit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SetNotifyModal;
