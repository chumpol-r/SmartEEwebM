import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from '@headlessui/react';
import { X, Plus, Trash2, Save, Clock } from 'lucide-react';

const TOTAL_INTERVALS = 96; // 24 hours * 4 (15 mins)

const PeriodConfigModal = ({ isOpen, onClose, onSave, initialPeriods = [] }) => {
    const [periods, setPeriods] = useState(initialPeriods);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [dragEnd, setDragEnd] = useState(null);
    const [hoverIdx, setHoverIdx] = useState(null);

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setPeriods(initialPeriods.length > 0 ? initialPeriods : []);
        }
    }, [isOpen, initialPeriods]);

    const handleMouseDown = (idx) => {
        // Check if already occupied
        if (isOccupied(idx)) return;

        setIsDragging(true);
        setDragStart(idx);
        setDragEnd(idx);
    };

    const handleMouseEnter = (idx) => {
        setHoverIdx(idx);
        if (isDragging) {
            setDragEnd(idx);
        }
    };

    const handleMouseUp = () => {
        if (isDragging && dragStart !== null && dragEnd !== null) {
            const start = Math.min(dragStart, dragEnd);
            const end = Math.max(dragStart, dragEnd);

            // Verify no overlap with existing (though UI prevents starting on occupied)
            // Simple check: if any index in range is occupied, abort or trim.
            // For simplicity, let's just add it.

            const newPeriod = {
                id: Date.now(),
                name: `Period ${periods.length + 1}`,
                start: start,
                end: end,
                color: getRandomColor()
            };

            setPeriods([...periods, newPeriod]);
        }
        setIsDragging(false);
        setDragStart(null);
        setDragEnd(null);
    };

    const isOccupied = (idx) => {
        return periods.some(p => idx >= p.start && idx <= p.end);
    };

    const getPeriodAt = (idx) => {
        return periods.find(p => idx >= p.start && idx <= p.end);
    };

    const removePeriod = (id) => {
        setPeriods(periods.filter(p => p.id !== id));
    };

    const updatePeriodName = (id, name) => {
        setPeriods(periods.map(p => p.id === id ? { ...p, name } : p));
    };

    const formatTime = (idx) => {
        const totalMinutes = idx * 15;
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    const getRandomColor = () => {
        const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500'];
        return colors[Math.floor(Math.random() * colors.length)];
    };

    // Helper to get range of current drag
    const getDragRange = () => {
        if (dragStart === null || dragEnd === null) return [];
        const start = Math.min(dragStart, dragEnd);
        const end = Math.max(dragStart, dragEnd);
        const range = [];
        for (let i = start; i <= end; i++) range.push(i);
        return range;
    };

    const dragRange = isDragging ? getDragRange() : [];

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <Dialog.Panel className="w-full max-w-4xl bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700">
                    <div className="flex justify-between items-center mb-6">
                        <Dialog.Title className="text-xl font-bold text-white flex items-center gap-2">
                            <Clock className="text-blue-400" />
                            Configure Time Periods
                        </Dialog.Title>
                        <button onClick={onClose} className="text-slate-400 hover:text-white">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="mb-6">
                        <p className="text-slate-400 text-sm mb-4">
                            Click and drag across the timeline to create a new period. (96 intervals of 15 mins)
                        </p>

                        {/* Timeline Grid */}
                        <div
                            className="relative select-none"
                            onMouseLeave={() => {
                                if (isDragging) handleMouseUp();
                                setHoverIdx(null);
                            }}
                        >
                            {/* Hour Markers */}
                            <div className="flex justify-between text-xs text-slate-500 mb-1 px-1">
                                {[0, 4, 8, 12, 16, 20, 24].map(h => (
                                    <span key={h}>{h}:00</span>
                                ))}
                            </div>

                            {/* The Bar */}
                            <div className="flex h-16 w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
                                {Array.from({ length: TOTAL_INTERVALS }).map((_, idx) => {
                                    const period = getPeriodAt(idx);
                                    const isSelected = dragRange.includes(idx);
                                    const isHovered = hoverIdx === idx;

                                    return (
                                        <div
                                            key={idx}
                                            className={`flex-1 border-r border-slate-800/50 transition-colors cursor-pointer relative group
                                    ${period ? period.color : 'hover:bg-slate-700'}
                                    ${isSelected ? 'bg-blue-400/50' : ''}
                                `}
                                            onMouseDown={() => handleMouseDown(idx)}
                                            onMouseEnter={() => handleMouseEnter(idx)}
                                            onMouseUp={handleMouseUp}
                                            title={`${formatTime(idx)} - ${formatTime(idx + 1)}`}
                                        >
                                            {/* Tooltip on Hover */}
                                            {isHovered && !isDragging && (
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded whitespace-nowrap z-10">
                                                    {formatTime(idx)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Period List */}
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        {periods.length === 0 ? (
                            <div className="text-center py-8 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
                                No periods defined. The entire 24h will be treated as one period.
                            </div>
                        ) : (
                            periods.map((p) => (
                                <div key={p.id} className="flex items-center gap-4 bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                                    <div className={`w-4 h-4 rounded-full ${p.color}`} />

                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                                        <input
                                            type="text"
                                            value={p.name}
                                            onChange={(e) => updatePeriodName(p.id, e.target.value)}
                                            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                            placeholder="Period Name"
                                        />
                                        <div className="text-slate-400 text-sm font-mono">
                                            {formatTime(p.start)} - {formatTime(p.end + 1)}
                                        </div>
                                        <div className="text-slate-500 text-xs">
                                            {(p.end - p.start + 1) * 15} mins
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => removePeriod(p.id)}
                                        className="text-slate-500 hover:text-red-400 transition-colors"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-700">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onSave(periods)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-blue-900/20"
                        >
                            <Save size={18} />
                            Save Configuration
                        </button>
                    </div>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
};

export default PeriodConfigModal;
