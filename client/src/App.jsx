import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Realtime from './pages/Realtime';
import Report from './pages/Report';
import Comparison from './pages/Comparison';
import Billing from './pages/Billing';
import Total from './pages/Total';
import Profile from './pages/Profile';
import Permission from './pages/Permission';
import Smartboard from './pages/Smartboard';
import Member from './pages/Member';
import Setting from './pages/Setting';
import Scan from './pages/Scan';
import CustomView from './pages/CustomView';
import CarbonCredit from './pages/CarbonCredit';
import NotifyConfig from './pages/NotifyConfig';
import NotifyLog from './pages/NotifyLog';
import SavedViewDisplay from './pages/SavedViewDisplay';
import AccessDenied from './pages/AccessDenied';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import { ConfigProvider } from './contexts/ConfigContext';
import { MQTTProvider } from './contexts/MQTTContext';

// Menu ID Mapping (Must match database)
const MENU_IDS = {
    '/report': 10,
    '/total': 22,
    '/profile': 31,
    '/member': 32,
    '/permission': 33,
    '/setting': 34,
    '/comparison': 35,
    '/realtime': 36,
    '/billing': 37,
    '/dashboard': 38,
    '/smartboard': 39,
    '/carbon-credit': 40,
    '/custom-view': 41,
};

// Protected Route Wrapper
const ProtectedRoute = ({ children }) => {
    const token = localStorage.getItem('token');
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState(false);

    useEffect(() => {
        const checkPermission = async () => {
            if (!token) {
                setLoading(false);
                return;
            }

            // Always allow dashboard and profile? Or check them too?
            // Dashboard is usually default, but let's check if it has an ID.
            // If path is not in MENU_IDS, assume public or default allowed (like /)
            const menuId = MENU_IDS[location.pathname];

            if (!menuId) {
                // If not in map, allow (e.g. / or unknown routes handled by 404 later)
                setHasAccess(true);
                setLoading(false);
                return;
            }

            try {
                const response = await axios.get('/api/user/permissions', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const allowedMenus = response.data;

                console.log('=== Permission Debug ===');
                console.log('Path:', location.pathname);
                console.log('MenuId:', menuId);
                console.log('AllowedMenus:', allowedMenus);
                console.log('Includes check:', allowedMenus.includes(menuId));

                if (allowedMenus.includes(menuId)) {
                    setHasAccess(true);
                } else {
                    setHasAccess(false);
                }
            } catch (error) {
                console.error("Error checking permissions:", error);
                setHasAccess(false);
            } finally {
                setLoading(false);
            }
        };

        checkPermission();
    }, [token, location.pathname]);

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    if (loading) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;
    }

    if (!hasAccess) {
        return <Navigate to="/access-denied" replace />;
    }

    return <Layout>{children}</Layout>;
};

function App() {
    return (
        <ConfigProvider>
            <ToastProvider>
                <MQTTProvider>
                    <Router>
                        <Routes>
                            <Route path="/login" element={<Login />} />
                            <Route path="/scan" element={<Scan />} />
                            <Route path="/access-denied" element={<AccessDenied />} />

                            <Route path="/custom-view" element={
                                <ProtectedRoute>
                                    <CustomView />
                                </ProtectedRoute>
                            } />
                            <Route path="/saved-view/:id" element={
                                <ProtectedRoute>
                                    <SavedViewDisplay />
                                </ProtectedRoute>
                            } />

                            <Route path="/dashboard" element={
                                <ProtectedRoute>
                                    <Dashboard />
                                </ProtectedRoute>
                            } />

                            <Route path="/realtime" element={
                                <ProtectedRoute>
                                    <Realtime />
                                </ProtectedRoute>
                            } />

                            <Route path="/report" element={
                                <ProtectedRoute>
                                    <Report />
                                </ProtectedRoute>
                            } />

                            <Route path="/comparison" element={
                                <ProtectedRoute>
                                    <Comparison />
                                </ProtectedRoute>
                            } />

                            <Route path="/billing" element={
                                <ProtectedRoute>
                                    <Billing />
                                </ProtectedRoute>
                            } />

                            <Route path="/total" element={
                                <ProtectedRoute>
                                    <Total />
                                </ProtectedRoute>
                            } />

                            <Route path="/profile" element={
                                <ProtectedRoute>
                                    <Profile />
                                </ProtectedRoute>
                            } />

                            <Route path="/permission" element={
                                <ProtectedRoute>
                                    <Permission />
                                </ProtectedRoute>
                            } />

                            <Route path="/smartboard" element={
                                <ProtectedRoute>
                                    <Smartboard />
                                </ProtectedRoute>
                            } />

                            <Route path="/setting" element={
                                <ProtectedRoute>
                                    <Setting />
                                </ProtectedRoute>
                            } />

                            <Route path="/member" element={
                                <ProtectedRoute>
                                    <Member />
                                </ProtectedRoute>
                            } />

                            <Route path="/carbon-credit" element={
                                <ProtectedRoute>
                                    <CarbonCredit />
                                </ProtectedRoute>
                            } />

                            <Route path="/notify-config" element={
                                <ProtectedRoute>
                                    <NotifyConfig />
                                </ProtectedRoute>
                            } />

                            <Route path="/notify-log" element={
                                <ProtectedRoute>
                                    <NotifyLog />
                                </ProtectedRoute>
                            } />

                            {/* Fallback routes */}
                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="*" element={<div className="text-white text-center mt-20">404 - Page Not Found</div>} />
                        </Routes>
                    </Router>
                </MQTTProvider>
            </ToastProvider>
        </ConfigProvider>
    );
}

export default App;
