import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Plus, Edit2, Trash2, X, Save, User, Lock, Mail, Shield, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '../components/Toast';

const Member = () => {
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'Viewer',
        active: 'Y'
    });

    useEffect(() => {
        fetchUsers();
        fetchRoles();
    }, []);

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get('/api/users', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(response.data);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching users:", error);
            setLoading(false);
        }
    };

    const fetchRoles = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get('/api/roles', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setRoles(response.data);
        } catch (error) {
            console.error("Error fetching roles:", error);
        }
    };

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
    };

    const filteredUsers = users.filter(user => {
        const search = searchTerm.toLowerCase();
        const name = (user.name || user.c_name || '').toLowerCase();
        const email = (user.email || user.c_email || '').toLowerCase();
        const role = (user.role || '').toLowerCase();
        const group = (user.group || user.group_name || '').toLowerCase();
        return name.includes(search) || email.includes(search) || role.includes(search) || group.includes(search);
    });

    const handleAdd = () => {
        setEditingUser(null);
        setFormData({
            name: '',
            email: '',
            password: '',
            role: roles.length > 0 ? roles[0] : 'Viewer',
            active: 'Y'
        });
        setIsModalOpen(true);
    };

    const handleEdit = (user) => {
        setEditingUser(user);
        setFormData({
            name: user.name,
            email: user.email,
            password: '', // Don't show password
            role: user.role,
            active: user.active
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        const confirmed = await toast.confirm('Are you sure you want to delete this user?', {
            title: 'Delete User',
            type: 'error',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`/api/users/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('User deleted successfully!');
            fetchUsers();
        } catch (error) {
            console.error('Error deleting user:', error);
            toast.error('Failed to delete user');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('token');
            if (editingUser) {
                await axios.put(`/api/users/${editingUser.id}`, formData, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } else {
                await axios.post('/api/users', formData, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
            setIsModalOpen(false);
            toast.success(editingUser ? 'User updated successfully!' : 'User created successfully!');
            fetchUsers();
        } catch (error) {
            console.error('Error saving user:', error);
            toast.error('Failed to save user: ' + (error.response?.data?.message || error.message));
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Member Management</h1>
                    <p className="text-slate-400">Manage users and permissions</p>
                </div>
                <button
                    onClick={handleAdd}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                >
                    <Plus size={20} />
                    <span>Add User</span>
                </button>
            </div>

            {/* Search and Filter */}
            <div className="flex gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={handleSearch}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-900/50 border-b border-slate-700">
                                <th className="p-4 text-slate-400 font-medium">User</th>
                                <th className="p-4 text-slate-400 font-medium">Group</th>
                                <th className="p-4 text-slate-400 font-medium">Permission</th>
                                <th className="p-4 text-slate-400 font-medium">Active</th>
                                <th className="p-4 text-slate-400 font-medium">Request Date</th>
                                <th className="p-4 text-slate-400 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-slate-400">Loading users...</td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-slate-400">No users found</td>
                                </tr>
                            ) : (
                                filteredUsers.map((user, index) => (
                                    <tr key={user.id || user.u_id || index} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-lg">
                                                    {user.picture ? <img src={user.picture} alt={user.name || user.c_name} className="w-full h-full rounded-full object-cover" /> : '👤'}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-white">{user.name || user.c_name || '-'}</div>
                                                    <div className="text-sm text-slate-400">{user.email || user.c_email || '-'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-slate-300">{user.group || user.group_name || '-'}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 rounded-full bg-slate-700 text-slate-300 text-sm border border-slate-600">
                                                {user.role || user.c_type || '-'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            {(user.active || user.c_active) === 'Y' ? (
                                                <span className="flex items-center gap-2 text-green-400 text-sm">
                                                    <CheckCircle size={16} /> Active
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-2 text-red-400 text-sm">
                                                    <XCircle size={16} /> Inactive
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-slate-400 text-sm">
                                            {(user.requestDate || user.dt_request) ? new Date(user.requestDate || user.dt_request).toLocaleDateString('th-TH') : '-'}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(user)}
                                                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                >
                                                    <Edit2 size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(user.id)}
                                                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-700">
                            <h2 className="text-xl font-bold text-white">
                                {editingUser ? 'Edit User' : 'Add New User'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                                        placeholder="John Doe"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                                        placeholder="john@example.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">
                                    {editingUser ? 'New Password (leave blank to keep)' : 'Password'}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="password"
                                        required={!editingUser}
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Role</label>
                                <div className="relative">
                                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <select
                                        value={formData.role}
                                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-blue-500 appearance-none"
                                    >
                                        {roles.map(role => (
                                            <option key={role} value={role}>{role}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="active"
                                            value="Y"
                                            checked={formData.active === 'Y'}
                                            onChange={(e) => setFormData({ ...formData, active: e.target.value })}
                                            className="accent-blue-500"
                                        />
                                        <span className="text-white">Active</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="active"
                                            value="N"
                                            checked={formData.active === 'N'}
                                            onChange={(e) => setFormData({ ...formData, active: e.target.value })}
                                            className="accent-red-500"
                                        />
                                        <span className="text-white">Inactive</span>
                                    </label>
                                </div>
                            </div>
                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Save size={18} />
                                    <span>Save User</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Member;
