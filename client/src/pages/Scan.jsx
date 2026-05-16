import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { User, Lock, Cpu, CheckCircle, AlertCircle, Loader, Building2, LogIn } from 'lucide-react';

const Scan = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const serial = searchParams.get('serial');

    // Status: loading, not_found, already_linked, available, success, error
    const [status, setStatus] = useState('loading');
    const [message, setMessage] = useState('');
    const [linkedInfo, setLinkedInfo] = useState({ siteName: '', groupName: '' });

    // Auth State
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isAutoRegistering, setIsAutoRegistering] = useState(false);

    // Registration Form
    const [showRegisterForm, setShowRegisterForm] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [groupName, setGroupName] = useState('');
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Prevent double execution (React Strict Mode)
    const hasChecked = useRef(false);
    const isRegistering = useRef(false);

    // Check serial status on load
    useEffect(() => {
        if (!serial) {
            setStatus('error');
            setMessage('No Serial ID found in URL');
            return;
        }

        // Prevent double execution in React Strict Mode
        if (hasChecked.current) return;
        hasChecked.current = true;

        // Check if user is logged in
        const token = localStorage.getItem('token');
        setIsLoggedIn(!!token);

        // Check serial status
        checkSerialStatus();
    }, [serial]);

    const checkSerialStatus = async () => {
        setStatus('loading');
        try {
            const res = await axios.get(`/api/scan/check?serial=${serial}`);
            const data = res.data;

            if (data.status === 'not_found') {
                setStatus('not_found');
                setMessage(data.message);
            } else if (data.status === 'already_linked') {
                setStatus('already_linked');
                setMessage(data.message);
                setLinkedInfo({ siteName: data.siteName, groupName: data.groupName });
            } else if (data.status === 'available') {
                setStatus('available');
                setMessage(data.message);

                // If user is logged in, auto-register
                const token = localStorage.getItem('token');
                if (token) {
                    autoRegisterForUser(token);
                }
            }
        } catch (err) {
            setStatus('error');
            setMessage(err.response?.data?.message || 'An error occurred');
        }
    };

    const autoRegisterForUser = async (token) => {
        // Prevent double registration
        if (isRegistering.current) return;
        isRegistering.current = true;

        setIsAutoRegistering(true);
        try {
            const res = await axios.post('/api/scan/register',
                { serial },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (res.data.success) {
                setStatus('success');
                setMessage(res.data.message);
                setLinkedInfo({ siteName: res.data.siteName, groupName: res.data.groupName });
            } else {
                setStatus('error');
                setMessage(res.data.message);
            }
        } catch (err) {
            setStatus('error');
            setMessage(err.response?.data?.message || 'Unable to register device');
        } finally {
            setIsAutoRegistering(false);
        }
    };

    const handleFullRegister = async (e) => {
        e.preventDefault();
        setFormError('');
        setIsSubmitting(true);

        try {
            const res = await axios.post('/api/scan/full-register', {
                username,
                password,
                groupName,
                serial
            });

            if (res.data.success) {
                // Auto login
                localStorage.setItem('token', res.data.token);
                localStorage.setItem('user', JSON.stringify(res.data.user));

                setStatus('success');
                setMessage('Registration successful! Logging in...');
                setLinkedInfo({ siteName: res.data.siteName, groupName: res.data.groupName });

                // Redirect to dashboard after delay
                setTimeout(() => navigate('/dashboard'), 2000);
            }
        } catch (err) {
            setFormError(err.response?.data?.message || 'An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleLoginRedirect = () => {
        // Save return URL
        localStorage.setItem('returnUrl', `/scan?serial=${serial}`);
        navigate('/login');
    };

    // Loading State
    if (status === 'loading' || isAutoRegistering) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
                <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full text-center">
                    <Loader className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
                    <h2 className="text-xl font-bold mb-2">{isAutoRegistering ? 'Registering device...' : 'Checking...'}</h2>
                    <p className="text-slate-400 font-mono bg-slate-900/50 px-3 py-1.5 rounded-lg inline-block">{serial}</p>
                </div>
            </div>
        );
    }

    // Case 1: Serial Not Found
    if (status === 'not_found') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
                <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertCircle className="w-10 h-10 text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Serial ID Not Found</h2>
                    <p className="text-slate-400 mb-2">{message}</p>
                    <p className="text-slate-500 font-mono bg-slate-900/50 px-3 py-1.5 rounded-lg inline-block mb-6">{serial}</p>
                    <div className="space-y-3">
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors font-medium"
                        >
                            Go to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Case 2: Serial Already Linked
    if (status === 'already_linked') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
                <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertCircle className="w-10 h-10 text-yellow-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Device Already Registered</h2>
                    <p className="text-slate-400 mb-4">{message}</p>
                    <p className="text-slate-500 font-mono bg-slate-900/50 px-3 py-1.5 rounded-lg inline-block mb-4">{serial}</p>

                    <div className="bg-slate-900/50 rounded-xl p-4 mb-6 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <Building2 size={18} className="text-blue-400" />
                            <div>
                                <div className="text-xs text-slate-500">Group</div>
                                <div className="font-medium">{linkedInfo.groupName || 'N/A'}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Building2 size={18} className="text-green-400" />
                            <div>
                                <div className="text-xs text-slate-500">Site</div>
                                <div className="font-medium">{linkedInfo.siteName || 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors font-medium"
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Case 3 & 4: Serial Available
    if (status === 'available' && !isLoggedIn) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
                <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Cpu className="w-8 h-8 text-blue-400" />
                        </div>
                        <h1 className="text-2xl font-bold">Device Found</h1>
                        <p className="text-slate-400 mt-2">Serial: <span className="font-mono bg-slate-900/50 px-2 py-1 rounded">{serial}</span></p>
                    </div>

                    {!showRegisterForm ? (
                        <div className="space-y-4">
                            <button
                                onClick={handleLoginRedirect}
                                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors font-medium"
                            >
                                <LogIn size={20} />
                                Login (Have an account)
                            </button>
                            <button
                                onClick={() => setShowRegisterForm(true)}
                                className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 rounded-xl transition-colors font-medium"
                            >
                                Create New Account
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleFullRegister} className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Username</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                                        placeholder="Username"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                                        placeholder="Password"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Group / Site Name</label>
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                                    <input
                                        type="text"
                                        value={groupName}
                                        onChange={(e) => setGroupName(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                                        placeholder="e.g. My Home, Office"
                                        required
                                    />
                                </div>
                                <p className="text-xs text-slate-500 mt-1">This name will be used for both Group and Site</p>
                            </div>

                            {formError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                                    {formError}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 rounded-xl transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : 'Create Account & Register Device'}
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowRegisterForm(false)}
                                className="w-full text-slate-400 hover:text-white text-sm transition-colors"
                            >
                                Go Back
                            </button>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    // Success State
    if (status === 'success') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
                <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Registration Successful!</h2>
                    <p className="text-slate-400 mb-4">{message}</p>
                    <p className="text-slate-500 font-mono bg-slate-900/50 px-3 py-1.5 rounded-lg inline-block mb-4">{serial}</p>

                    <div className="bg-slate-900/50 rounded-xl p-4 mb-6 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <Building2 size={18} className="text-blue-400" />
                            <div>
                                <div className="text-xs text-slate-500">Group</div>
                                <div className="font-medium">{linkedInfo.groupName || 'N/A'}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Building2 size={18} className="text-green-400" />
                            <div>
                                <div className="text-xs text-slate-500">Site</div>
                                <div className="font-medium">{linkedInfo.siteName || 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors font-medium"
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Error State
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center text-white p-4">
            <div className="bg-slate-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700/50 max-w-md w-full text-center">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-10 h-10 text-red-400" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Error</h2>
                <p className="text-red-400 mb-6">{message}</p>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors font-medium"
                >
                    Go to Dashboard
                </button>
            </div>
        </div>
    );
};

export default Scan;
