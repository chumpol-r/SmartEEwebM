import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldAlert, LogIn, Home } from 'lucide-react';

const AccessDenied = () => {
    const navigate = useNavigate();

    const handleLogout = () => {
        // Clear token and go to login
        localStorage.removeItem('token');
        navigate('/login');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
            <div className="text-center p-8 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl max-w-md">
                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                        <ShieldAlert size={48} className="text-red-500" />
                    </div>
                </div>
                <h1 className="text-3xl font-bold mb-4">Access Denied</h1>
                <p className="text-slate-400 mb-8">
                    You do not have permission to view this page. <br />
                    Please contact your administrator if you believe this is a mistake.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        to="/dashboard"
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                    >
                        <Home size={18} />
                        Return to Dashboard
                    </Link>
                    <button
                        onClick={handleLogout}
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-colors"
                    >
                        <LogIn size={18} />
                        Login with Different Account
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AccessDenied;
