import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Activity, FileText, Settings, LogOut, Menu, X, BarChart2, DollarSign, PieChart, User, Shield, Monitor, Zap, PencilRuler, Leaf, Eye, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs) {
    return twMerge(clsx(inputs));
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
        '/member': 32
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
    ];

    const [user, setUser] = useState(null);

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
                                            if (!allowedMenus.includes(menuId)) return false;
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

                <main className={cn("p-6", isCustomView && "p-0 h-[calc(100vh-64px)] overflow-hidden")}>
                    {children}
                </main>
            </div>
        </div >
    );
};

export default Layout;
