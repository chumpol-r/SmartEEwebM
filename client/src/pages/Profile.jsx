import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { User, Mail, Lock, Camera, Save, AlertCircle, CheckCircle } from 'lucide-react';

const Profile = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState({ type: '', text: '' });

    // Edit Mode
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        picture: ''
    });

    // Password Change
    const [passData, setPassData] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('/api/profile', {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Profile data:', res.data); // Debug log
            setUser(res.data);
            setFormData({
                name: res.data.c_name || '',
                email: res.data.c_email || '',
                picture: res.data.c_picture || ''
            });
        } catch (err) {
            console.error("Failed to fetch profile", err);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('token');
            await axios.put('/api/profile', formData, {
                headers: { Authorization: `Bearer ${token}` }
            });

            // Update localStorage so sidebar refreshes
            const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
            const updatedUser = {
                ...storedUser,
                name: formData.name,
                picture: formData.picture
            };
            localStorage.setItem('user', JSON.stringify(updatedUser));

            // Dispatch event to notify Layout to refresh
            window.dispatchEvent(new Event('userUpdated'));

            setMessage({ type: 'success', text: 'Profile updated successfully!' });
            setIsEditing(false);
            fetchProfile();
        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: 'Failed to update profile.' });
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (passData.newPassword !== passData.confirmPassword) {
            return setMessage({ type: 'error', text: 'New passwords do not match.' });
        }
        try {
            const token = localStorage.getItem('token');
            await axios.put('/api/profile/password', {
                oldPassword: passData.oldPassword,
                newPassword: passData.newPassword
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setMessage({ type: 'success', text: 'Password changed successfully!' });
            setPassData({ oldPassword: '', newPassword: '', confirmPassword: '' });
        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to change password.' });
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData({ ...formData, picture: reader.result });
            };
            reader.readAsDataURL(file);
        }
    };

    if (loading) return <div className="text-white p-8">Loading...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <User className="text-blue-400" /> My Profile
            </h1>

            {message.text && (
                <div className={`p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
                    {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Profile Card */}
                <div className="md:col-span-1">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 flex flex-col items-center text-center">
                        <div className="relative w-32 h-32 mb-4">
                            {formData.picture ? (
                                <img src={formData.picture} alt="Profile" className="w-full h-full rounded-full object-cover border-4 border-slate-700" />
                            ) : (
                                <div className="w-full h-full rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                                    <User size={48} />
                                </div>
                            )}
                            {isEditing && (
                                <label className="absolute bottom-0 right-0 bg-blue-600 p-2 rounded-full cursor-pointer hover:bg-blue-500 transition-colors">
                                    <Camera size={16} className="text-white" />
                                    <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                                </label>
                            )}
                        </div>
                        <h2 className="text-xl font-bold text-white">{user?.c_name}</h2>
                        <p className="text-slate-400 text-sm">{user?.c_email}</p>
                        <div className="mt-4 px-3 py-1 bg-slate-700 rounded-full text-xs text-blue-300 uppercase font-bold tracking-wider">
                            {user?.c_type}
                        </div>
                    </div>
                </div>

                {/* Edit Form */}
                <div className="md:col-span-2 space-y-6">
                    {/* Personal Info */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <User size={20} className="text-blue-400" /> Personal Information
                            </h3>
                            {!isEditing && (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="text-sm text-blue-400 hover:text-blue-300 underline"
                                >
                                    Edit Profile
                                </button>
                            )}
                        </div>

                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    disabled={!isEditing}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                    value={formData.name || ''}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Email Address</label>
                                <div className="relative">
                                    <Mail size={18} className="absolute left-3 top-2.5 text-slate-500" />
                                    <input
                                        type="email"
                                        disabled={!isEditing}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                        value={formData.email || ''}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                            </div>

                            {isEditing && (
                                <div className="flex justify-end gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => { setIsEditing(false); setFormData({ name: user.c_name, email: user.c_email, picture: user.c_picture }); }}
                                        className="px-4 py-2 text-slate-300 hover:text-white"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                                    >
                                        <Save size={18} /> Save Changes
                                    </button>
                                </div>
                            )}
                        </form>
                    </div>

                    {/* Change Password */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                            <Lock size={20} className="text-yellow-400" /> Change Password
                        </h3>
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-400 mb-1">Current Password</label>
                                <input
                                    type="password"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    value={passData.oldPassword}
                                    onChange={(e) => setPassData({ ...passData, oldPassword: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">New Password</label>
                                    <input
                                        type="password"
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                        value={passData.newPassword}
                                        onChange={(e) => setPassData({ ...passData, newPassword: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Confirm New Password</label>
                                    <input
                                        type="password"
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                        value={passData.confirmPassword}
                                        onChange={(e) => setPassData({ ...passData, confirmPassword: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Update Password
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
