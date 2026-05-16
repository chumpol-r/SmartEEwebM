import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, X, Info } from 'lucide-react';

// Toast Context
const ToastContext = createContext(null);

// Toast Types Configuration
const toastConfig = {
    success: {
        icon: CheckCircle,
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/50',
        iconColor: 'text-emerald-400',
        titleColor: 'text-emerald-300',
    },
    error: {
        icon: AlertCircle,
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/50',
        iconColor: 'text-red-400',
        titleColor: 'text-red-300',
    },
    warning: {
        icon: AlertTriangle,
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/50',
        iconColor: 'text-amber-400',
        titleColor: 'text-amber-300',
    },
    info: {
        icon: Info,
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/50',
        iconColor: 'text-blue-400',
        titleColor: 'text-blue-300',
    }
};

// Single Toast Component
const Toast = ({ id, type = 'info', title, message, onClose }) => {
    const config = toastConfig[type] || toastConfig.info;
    const Icon = config.icon;

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-2xl
                ${config.bgColor} ${config.borderColor}
                animate-slide-in-right
                min-w-[320px] max-w-[420px]
            `}
        >
            <div className={`p-1.5 rounded-lg ${config.bgColor}`}>
                <Icon size={20} className={config.iconColor} />
            </div>
            <div className="flex-1 min-w-0">
                {title && (
                    <h4 className={`font-semibold ${config.titleColor} mb-0.5`}>{title}</h4>
                )}
                <p className="text-slate-300 text-sm leading-relaxed">{message}</p>
            </div>
            <button
                onClick={() => onClose(id)}
                className="text-slate-500 hover:text-white transition-colors p-1 -mr-1 -mt-1"
            >
                <X size={16} />
            </button>
        </div>
    );
};

// Toast Container
const ToastContainer = ({ toasts, removeToast }) => {
    return (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3">
            {toasts.map((toast) => (
                <Toast key={toast.id} {...toast} onClose={removeToast} />
            ))}
        </div>
    );
};

// Confirm Dialog Component
const ConfirmDialog = ({ isOpen, title, message, type = 'warning', onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) => {
    if (!isOpen) return null;

    const config = toastConfig[type] || toastConfig.warning;
    const Icon = config.icon;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onCancel}
            />

            {/* Dialog */}
            <div className="relative bg-slate-800/95 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl max-w-md w-full animate-scale-in">
                {/* Header */}
                <div className="p-6 pb-4">
                    <div className={`w-14 h-14 rounded-xl ${config.bgColor} flex items-center justify-center mx-auto mb-4`}>
                        <Icon size={28} className={config.iconColor} />
                    </div>
                    <h3 className="text-xl font-bold text-white text-center">{title}</h3>
                    <p className="text-slate-400 text-center mt-2">{message}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 p-4 pt-2 border-t border-slate-700/50">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors
                            ${type === 'error' ? 'bg-red-600 hover:bg-red-500 text-white' :
                                type === 'warning' ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                                    type === 'success' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' :
                                        'bg-blue-600 hover:bg-blue-500 text-white'}
                        `}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Toast Provider
export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        resolve: null
    });

    // Add Toast
    const toast = useCallback((message, options = {}) => {
        const id = Date.now() + Math.random();
        const newToast = {
            id,
            message,
            type: options.type || 'info',
            title: options.title || null,
        };

        setToasts(prev => [...prev, newToast]);

        // Auto remove after duration
        const duration = options.duration || 4000;
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);

        return id;
    }, []);

    // Toast shortcuts
    const success = useCallback((message, options = {}) => {
        return toast(message, { ...options, type: 'success', title: options.title || 'Success' });
    }, [toast]);

    const error = useCallback((message, options = {}) => {
        return toast(message, { ...options, type: 'error', title: options.title || 'Error' });
    }, [toast]);

    const warning = useCallback((message, options = {}) => {
        return toast(message, { ...options, type: 'warning', title: options.title || 'Warning' });
    }, [toast]);

    const info = useCallback((message, options = {}) => {
        return toast(message, { ...options, type: 'info', title: options.title || 'Info' });
    }, [toast]);

    // Remove Toast
    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Confirm Dialog
    const confirm = useCallback((message, options = {}) => {
        return new Promise((resolve) => {
            setConfirmState({
                isOpen: true,
                title: options.title || 'Confirm Action',
                message,
                type: options.type || 'warning',
                confirmText: options.confirmText || 'Confirm',
                cancelText: options.cancelText || 'Cancel',
                resolve
            });
        });
    }, []);

    const handleConfirm = useCallback(() => {
        confirmState.resolve?.(true);
        setConfirmState(prev => ({ ...prev, isOpen: false }));
    }, [confirmState.resolve]);

    const handleCancel = useCallback(() => {
        confirmState.resolve?.(false);
        setConfirmState(prev => ({ ...prev, isOpen: false }));
    }, [confirmState.resolve]);

    const value = {
        toast,
        success,
        error,
        warning,
        info,
        confirm,
        removeToast
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
            <ConfirmDialog
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                type={confirmState.type}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </ToastContext.Provider>
    );
};

// Hook to use Toast
export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export default ToastProvider;
