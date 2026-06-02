import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Activity, FileText, Settings, LogOut, Menu, X, BarChart2, DollarSign, PieChart, User, Shield, Monitor, Zap, PencilRuler, Leaf, Eye, ChevronDown, ChevronRight, Search, Bell, BellRing, BellOff, CheckCircle2, Loader2, ClipboardList } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import SubscribeButton from './SubscribeButton.jsx';
import SubscriptionModal from './SubscriptionModal.jsx';

// Utility for tailwind classes
function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Stable per-browser device identity for notification subscriptions.
// Generated once, persisted in localStorage, and reused forever so the same
// browser always maps to the same subscription row (multi-device targeting).
function getDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
        id = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('deviceId', id);
    }
    return id;
}

// Human-readable device label (display only, never used for matching).
function getDeviceLabel() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
        : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows'
        : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
        : /Linux/.test(ua) ? 'Linux'
        : 'Unknown OS';
    return `${browser} on ${os}`;
}

// Convert a base64url VAPID public key into the Uint8Array that
// PushManager.subscribe() requires for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
}

const Layout = ({ children }) => {
    const [isOpen, setIsOpen] = useState(true);
    const [allowedMenus, setAllowedMenus] = useState([]);
    const [exportedViews, setExportedViews] = useState([]);
    const [menusExpanded, setMenusExpanded] = useState(true);
    const [viewsExpanded, setViewsExpanded] = useState(true);
    const [menuSearch, setMenuSearch] = useState('');
    const [viewSearch, setViewSearch] = useState('');
    const location = useLocation();
    const navigate = useNavigate();

    // Menu ID Mapping
    const menuIds = {
        '/report': 10,
        '/total': 22,
        '/profile': 31,
        '/permission': 33,
        '/setting': 34,
        '/comparison': 35,
        '/realtime': 36,
        '/billing': 37,
        '/dashboard': 38,
        '/smartboard': 39,
        '/carbon-credit': 40,
        '/custom-view': 41,
        '/member': 32,
        '/notify-config': 98,
        '/notify-log': 99,
    };

    useEffect(() => {
        const fetchPermissions = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) return;

                const response = await axios.get('/api/user/permissions', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                // API now returns array of { menuId, treeid }
                setAllowedMenus(response.data);
            } catch (error) {
                console.error("Error fetching permissions:", error);
            }
        };

        const fetchExportedViews = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) return;

                // Fetch exported views from WebMenu (parent is numeric = view id)
                const response = await axios.get('/api/menus/exported-views', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setExportedViews(response.data || []);
            } catch (error) {
                console.error("Error fetching exported views:", error);
            }
        };

        fetchPermissions();
        fetchExportedViews();
    }, []);

    const menuItems = [
        { path: '/carbon-credit', label: 'Carbon Credit', icon: Leaf },
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/realtime', label: 'Realtime', icon: Activity },
        { path: '/report', label: 'Report', icon: FileText },
        { path: '/comparison', label: 'Comparison', icon: BarChart2 },
        { path: '/billing', label: 'Billing', icon: DollarSign },
        { path: '/total', label: 'Total Energy', icon: PieChart },
        { path: '/member', label: 'Member', icon: User },
        { path: '/profile', label: 'Profile', icon: User },
        { path: '/permission', label: 'Permission', icon: Shield },
        { path: '/smartboard', label: 'Smartboard', icon: Monitor },
        { path: '/custom-view', label: 'Custom View', icon: PencilRuler },
        { path: '/setting', label: 'Setting', icon: Settings },
        { path: '/notify-config', label: 'Notify Config', icon: Bell },
        { path: '/notify-log', label: 'Notify Log', icon: ClipboardList },
    ];

    const [user, setUser] = useState(null);

    // --- Notification subscription state ---
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [subscriptionId, setSubscriptionId] = useState(null);
    const [subscribing, setSubscribing] = useState(false); // covers both subscribe & unsubscribe
    // Hint banner that appears on render then fades away after a few seconds
    const [showSubHint, setShowSubHint] = useState(false);
    // Subscription modal
    const [subModalOpen, setSubModalOpen] = useState(false);
    // Highest active tier across all device subscriptions (line > smart > free > null)
    const [currentTier, setCurrentTier] = useState(null);

    // Check current subscription status on mount
    useEffect(() => {
        const checkSubscription = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) return;
                const res = await axios.get('/api/subscription', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                // Reflect the status of THIS device only (match on our device_id),
                // so the button doesn't show "subscribed" because of another device.
                const myDeviceId = getDeviceId();
                const all = res.data?.data || [];
                const mine = all.find(s => s.channel === 'webpush' && s.deviceId === myDeviceId);
                setIsSubscribed(!!mine);
                setSubscriptionId(mine?.subscriptionId ?? null);
                // Resolve highest tier across user's subscriptions
                const hasLine  = all.some(s => s.channel === 'line');
                const hasSmart = all.some(s => s.channel === 'smart');
                setCurrentTier(hasLine ? 'line' : hasSmart ? 'smart' : mine ? 'free' : null);
                // Only nudge users who haven't subscribed on this device yet
                if (!mine) setShowSubHint(true);
            } catch (error) {
                console.error('Error checking subscription:', error);
            }
        };
        checkSubscription();
    }, []);

    // Auto-hide the hint banner a few seconds after it appears
    useEffect(() => {
        if (!showSubHint) return;
        const timer = setTimeout(() => setShowSubHint(false), 6000);
        return () => clearTimeout(timer);
    }, [showSubHint]);

    const handleSubscribe = async () => {
        if (subscribing) return;

        // Web Push needs a service worker + Push API (and a secure context: https or localhost).
        // In-app browsers (LINE, Facebook, Instagram) commonly strip these
        // APIs even on otherwise-capable Android Chrome, so we surface which
        // capability is missing to make that obvious rather than just saying
        // "not supported".
        const missing = [];
        if (!('serviceWorker' in navigator)) missing.push('Service Worker');
        if (!('PushManager' in window))      missing.push('Push API');
        if (typeof Notification === 'undefined') missing.push('Notification API');
        if (missing.length) {
            // Thrown so the SubscriptionModal can show it in its error panel.
            throw new Error(
                `This browser doesn't support Web Push (missing: ${missing.join(', ')}).\n` +
                'If you opened this from LINE, Facebook, or Instagram, tap the ⋮ menu ' +
                '(top-right) → "Open in Chrome" and try again.'
            );
        }

        setSubscribing(true);
        try {
            const token = localStorage.getItem('token');

            // 1) Ask the OS for notification permission.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('Notification permission not granted:', permission);
                throw new Error(
                    'Notification permission was blocked. Please allow notifications for this ' +
                    'site in your browser settings, then try again.'
                );
            }

            // 2) Register the service worker (idempotent — returns existing if already there).
            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            // 3) Fetch the server's VAPID public key.
            const keyRes = await axios.get('/api/webpush/public-key');
            const publicKey = keyRes.data?.publicKey;
            if (!publicKey) throw new Error("The server's push key is unavailable right now. Please try again later.");

            // 4) Subscribe via the browser's push service (FCM/APNs/etc).
            // Drop any stale subscription first — a leftover one bound to a
            // different VAPID key makes subscribe() throw "applicationServerKey
            // already exists".
            const existing = await registration.pushManager.getSubscription();
            if (existing) await existing.unsubscribe();

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });

            // 5) Persist the subscription on our server (whole object in `destination`).
            const res = await axios.post('/api/subscription',
                {
                    channel: 'webpush',
                    destination: JSON.stringify(subscription),
                    scope: 'all',
                    deviceId: getDeviceId(),
                    deviceLabel: getDeviceLabel(),
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setIsSubscribed(true);
            setSubscriptionId(res.data?.subscriptionId ?? null);
            setShowSubHint(false);
        } catch (error) {
            console.error('Error subscribing:', error);
            // Re-throw so the SubscriptionModal surfaces a clean message in its
            // error panel instead of the flow silently reporting success.
            throw error;
        } finally {
            setSubscribing(false);
        }
    };

    const handleUnsubscribe = async () => {
        if (subscribing || !subscriptionId) return;
        setSubscribing(true);
        try {
            const token = localStorage.getItem('token');

            // Tell the browser's push service to drop this endpoint, too.
            if ('serviceWorker' in navigator) {
                try {
                    const registration = await navigator.serviceWorker.ready;
                    const sub = await registration.pushManager.getSubscription();
                    if (sub) await sub.unsubscribe();
                } catch (_) { /* ignore — still deactivate server-side below */ }
            }

            await axios.delete(`/api/subscription/${subscriptionId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setIsSubscribed(false);
            setSubscriptionId(null);
        } catch (error) {
            console.error('Error unsubscribing:', error);
        } finally {
            setSubscribing(false);
        }
    };

    const handleToggleSubscribe = () => {
        if (subscribing) return;
        return isSubscribed ? handleUnsubscribe() : handleSubscribe();
    };

    // Persist a LINE Bot subscription. The backend verifies the token, checks
    // bot/group membership, encrypts the token at rest, and sends a test
    // message — surfacing any failure as a 400 with code+hint we can show
    // verbatim. We DO NOT mark the tier active unless the backend confirms.
    const handleSubscribeLine = async ({ token: lineToken, chatId }) => {
        const token = localStorage.getItem('token');
        try {
            const res = await axios.post('/api/subscription',
                {
                    channel: 'line',
                    destination: JSON.stringify({ token: lineToken, chatId }),
                    scope: 'all',
                    deviceId: getDeviceId(),
                    deviceLabel: getDeviceLabel(),
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setCurrentTier('line');
            return res.data; // includes { line: { bot, chat } }
        } catch (err) {
            // Re-throw a friendly Error so the modal's catch handler can show
            // a clean message instead of a raw "Request failed with 400".
            const body = err.response?.data;
            const msg  = body?.error || err.message || 'Failed to connect to LINE. Please try again.';
            const hint = body?.hint ? `\n${body.hint}` : '';
            const wrapped = new Error(`${msg}${hint}`);
            wrapped.code = body?.code;
            throw wrapped;
        }
    };

    // Persist a Smart EE subscription. The backend validates the Group ID +
    // Pin ID, encrypts the Pin at rest, and only confirms on success — mirroring
    // the LINE flow. We DO NOT mark the tier active unless the backend confirms.
    const handleSubscribeSmart = async ({ groupId, pinId }) => {
        const token = localStorage.getItem('token');
        try {
            const res = await axios.post('/api/subscription',
                {
                    channel: 'smart',
                    destination: JSON.stringify({ groupId, pinId }),
                    scope: 'all',
                    deviceId: getDeviceId(),
                    deviceLabel: getDeviceLabel(),
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            // Only promote to 'smart' if LINE (higher tier) isn't already active.
            setCurrentTier((t) => t === 'line' ? t : 'smart');
            return res.data; // includes { smart: { groupId } }
        } catch (err) {
            const body = err.response?.data;
            const msg  = body?.error || err.message || 'Failed to connect to Smart EE. Please try again.';
            const hint = body?.hint ? `\n${body.hint}` : '';
            const wrapped = new Error(`${msg}${hint}`);
            wrapped.code = body?.code;
            throw wrapped;
        }
    };

    // Unified submit handler for the SubscriptionModal. Returns a promise so
    // the modal can show its activating → activated state correctly.
    // Returns whatever the underlying API returned (or undefined for free
     // tier which uses the toggle flow) — the modal uses it to render the
     // "Bot → Group" success summary for LINE.
    const handleModalSubmit = async (payload) => {
        if (payload.tier === 'free') {
            // Mirror the original toggle behavior verbatim — handleToggleSubscribe
            // picks subscribe vs unsubscribe from `isSubscribed` and runs the full
            // browser-side flow (permission, SW, pushManager, POST/DELETE).
            await handleToggleSubscribe();
            // Reflect tier: only downgrade if higher tiers aren't active.
            setCurrentTier((t) => {
                if (t === 'line' || t === 'smart') return t;
                // After toggle, isSubscribed has flipped — use the action hint.
                return payload.action === 'unsubscribe' ? null : 'free';
            });
        } else if (payload.tier === 'line') {
            return await handleSubscribeLine({ token: payload.token, chatId: payload.chatId });
        } else if (payload.tier === 'smart') {
            return await handleSubscribeSmart({ groupId: payload.groupId, pinId: payload.pinId });
        }
    };

    useEffect(() => {
        const loadUser = () => {
            const storedUser = localStorage.getItem('user');
            if (storedUser) {
                setUser(JSON.parse(storedUser));
            }
        };
        

        loadUser();

        // Listen for profile updates
        window.addEventListener('userUpdated', loadUser);

        return () => {
            window.removeEventListener('userUpdated', loadUser);
        };
    }, []);



    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    const isCustomView = location.pathname === '/custom-view';

    return (
        <div className="flex min-h-screen bg-slate-900 text-white font-sans">

            {/* Keyframes for the Subscribe button animations */}
            <style>{`
                @keyframes sub-swing {
                    0%, 100% { transform: rotate(0deg); }
                    20% { transform: rotate(14deg); }
                    40% { transform: rotate(-11deg); }
                    60% { transform: rotate(7deg); }
                    80% { transform: rotate(-4deg); }
                }
                @keyframes sub-shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                }
                @keyframes sub-ping {
                    0% { transform: scale(1); opacity: 0.7; }
                    70%, 100% { transform: scale(1.25); opacity: 0; }
                }
                @keyframes sub-pop {
                    0% { transform: scale(0.6); opacity: 0; }
                    60% { transform: scale(1.12); }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>

            {/* Sidebar - Hidden on Custom View */}
            {!isCustomView && (
                <aside
                    className={cn(
                        "fixed inset-y-0 left-0 z-50 w-64 bg-slate-800 border-r border-slate-700 transition-transform duration-300 ease-in-out",
                        !isOpen && "-translate-x-full"
                    )}
                >
                    {/* Sidebar Header */}
                    <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Zap className="text-white fill-white" size={20} />
                        </div>
                        <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">
                                EE
                        </span>
                        <button onClick={() => setIsOpen(false)} className="lg:hidden text-slate-400 hover:text-white ml-auto">
                            <X size={24} />
                        </button>
                    </div>

                    <nav className="p-4 space-y-2 overflow-y-auto flex-1">
                        {/* Main Menu Section */}
                        <div className="mb-2">
                            <button
                                onClick={() => setMenusExpanded(!menusExpanded)}
                                className="w-full flex items-center justify-between px-2 py-2 text-xs text-slate-400 hover:text-white uppercase tracking-wider"
                            >
                                <span>Main Menu</span>
                                {menusExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            {menusExpanded && (
                                <>
                                    <div className="relative mb-2">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                        <input
                                            type="text"
                                            placeholder="Search menu..."
                                            value={menuSearch}
                                            onChange={(e) => setMenuSearch(e.target.value)}
                                            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                    {menuItems
                                        .filter(item => {
                                            const menuId = menuIds[item.path];
                                            if (item.path === '/profile') return false;
                                            if (!item.alwaysShow && !allowedMenus.includes(menuId)) return false;
                                            if (menuSearch && !item.label.toLowerCase().includes(menuSearch.toLowerCase())) return false;
                                            return true;
                                        })
                                        .sort((a, b) => {
                                            const treeidMap = {
                                                '/carbon-credit': 0, '/dashboard': 1, '/realtime': 2, '/comparison': 3,
                                                '/report': 4, '/custom-view': 5, '/billing': 5, '/total': 6, '/profile': 7,
                                                '/smartboard': 90, '/member': 91, '/permission': 92, '/setting': 93
                                            };
                                            return (treeidMap[a.path] ?? 999) - (treeidMap[b.path] ?? 999);
                                        })
                                        .map((item) => {
                                            const Icon = item.icon;
                                            const isActive = location.pathname === item.path;
                                            return (
                                                <Link
                                                    key={item.path}
                                                    to={item.path}
                                                    className={cn(
                                                        "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors",
                                                        isActive
                                                            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                                                            : "text-slate-400 hover:bg-slate-700 hover:text-white"
                                                    )}
                                                >
                                                    <Icon size={18} />
                                                    <span className="font-medium text-sm">{item.label}</span>
                                                </Link>
                                            );
                                        })}
                                </>
                            )}
                        </div>

                        {/* Exported Views Section */}
                        {exportedViews.length > 0 && (
                            <div className="border-t border-slate-700 pt-2">
                                <button
                                    onClick={() => setViewsExpanded(!viewsExpanded)}
                                    className="w-full flex items-center justify-between px-2 py-2 text-xs text-slate-400 hover:text-white uppercase tracking-wider"
                                >
                                    <span>Exported Views</span>
                                    {viewsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                {viewsExpanded && (
                                    <>
                                        <div className="relative mb-2">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                            <input
                                                type="text"
                                                placeholder="Search views..."
                                                value={viewSearch}
                                                onChange={(e) => setViewSearch(e.target.value)}
                                                className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        {exportedViews
                                            .filter(view => !viewSearch || view.name.toLowerCase().includes(viewSearch.toLowerCase()))
                                            .map((view) => {
                                                const isActive = location.pathname === `/saved-view/${view.viewId}`;
                                                return (
                                                    <Link
                                                        key={view.id}
                                                        to={`/saved-view/${view.viewId}`}
                                                        className={cn(
                                                            "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors",
                                                            isActive
                                                                ? "bg-green-600 text-white shadow-lg shadow-green-900/50"
                                                                : "text-slate-400 hover:bg-slate-700 hover:text-white"
                                                        )}
                                                    >
                                                        <Eye size={18} />
                                                        <span className="font-medium text-sm truncate">{view.name}</span>
                                                    </Link>
                                                );
                                            })}
                                    </>
                                )}
                            </div>
                        )}
                    </nav>
                </aside>
            )}

            {/* Main Content */}
            <div className={cn("flex-1 transition-all duration-300", !isCustomView && isOpen ? "ml-64" : "ml-0")}>
                <header className="h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-700 sticky top-0 z-40 flex items-center px-6 justify-between">
                    {!isCustomView && (
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800"
                        >
                            <Menu size={24} />
                        </button>
                    )}

                    {/* Custom View Header Elements (Back + Logo) */}
                    {isCustomView && (
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => navigate(-1)}
                                className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                                title="Go Back"
                            >
                                <ChevronRight className="rotate-180" size={20} />
                                <span className="hidden sm:inline text-sm font-medium">Back</span>
                            </button>

                            <div className="flex items-center gap-3 pl-4 border-l border-slate-700 h-8">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                                    <Zap className="text-white fill-white" size={20} />
                                </div>
                                <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">
                                        EE
                                </span>
                            </div>
                        </div>
                    )}

                    {/* User Info & Actions - Always Visible */}
                    {user && (
                        <div className="flex items-center gap-3">
                            {/* User Avatar & Info */}
                            <div className="flex items-center gap-3 pr-3 border-r border-slate-700">
                                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600 overflow-hidden">
                                    {user.picture ? (
                                        <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-base">👤</span>
                                    )}
                                </div>
                                <div className="hidden sm:block">
                                    <div className="text-sm font-medium text-white leading-tight">{user.name}</div>
                                    <div className="text-xs text-slate-400">{user.group}</div>
                                </div>
                            </div>

                            {/* Subscribe button — opens the SubscriptionModal */}
                            <SubscribeButton
                                onClick={() => { setShowSubHint(false); setSubModalOpen(true); }}
                                currentTier={currentTier}
                                busy={subscribing}
                                open={subModalOpen}
                            />

                            {/* Action Buttons - Always Visible */}
                            <Link
                                to="/profile"
                                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                            >
                                <User size={18} />
                                <span className="hidden md:inline">Profile</span>
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors"
                            >
                                <LogOut size={18} />
                                <span className="hidden md:inline">Logout</span>
                            </button>
                        </div>
                    )}
                </header>

                {/* Auto-fading subscription hint — appears on render, disappears after a few seconds */}
                <div
                    className={cn(
                        "fixed top-20 right-6 z-50 max-w-xs transition-all duration-700 ease-in-out",
                        showSubHint
                            ? "opacity-100 translate-y-0"
                            : "opacity-0 -translate-y-2 pointer-events-none"
                    )}
                >
                    <div className="flex items-start gap-3 bg-slate-800 border border-blue-500/40 rounded-xl px-4 py-3 shadow-lg shadow-blue-900/30">
                        <Bell size={18} className="text-blue-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-white">Enable notifications</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Tap the “Notifications” button above to receive real-time alerts
                            </p>
                        </div>
                    </div>
                </div>

                <main className={cn("p-6", isCustomView && "p-0 h-[calc(100vh-64px)] overflow-hidden")}>
                    {children}
                </main>
            </div>

            <SubscriptionModal
                open={subModalOpen}
                onClose={() => setSubModalOpen(false)}
                currentTier={currentTier}
                webPushSubscribed={isSubscribed}
                onSubmit={handleModalSubmit}
            />
        </div >
    );
};

export default Layout;
