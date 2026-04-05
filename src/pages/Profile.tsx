import { useState, useRef } from 'react';
import { Camera, Save, X, Activity, Users, Link as LinkIcon, Twitter, Linkedin, Instagram, Github, Mail, MapPin, Calendar, Shield, Bell, Key, Smartphone, Check, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Profile() {
  const [activeTab, setActiveTab] = useState('profile');
  const [profile, setProfile] = useState({
    username: 'Al Fardan Admin',
    role: 'Social Media Manager',
    bio: 'Focusing on UAE financial regulations and creative campaigns. Building the future of digital finance.',
    avatar: 'https://picsum.photos/seed/alfardan/200/200',
    location: 'Dubai, UAE',
    joined: 'March 2024'
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(profile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    pushNotifications: false,
    weeklyDigest: true,
    newMentions: true,
    campaignUpdates: false
  });

  const [connectedAccounts, setConnectedAccounts] = useState([
    { id: 'twitter', name: 'Twitter', icon: Twitter, connected: true, handle: '@alfardan_admin' },
    { id: 'linkedin', name: 'LinkedIn', icon: Linkedin, connected: true, handle: 'Al Fardan Exchange' },
    { id: 'instagram', name: 'Instagram', icon: Instagram, connected: false, handle: '' },
    { id: 'github', name: 'GitHub', icon: Github, connected: true, handle: 'alfardan-dev' },
  ]);

  const [teamMembers, setTeamMembers] = useState([
    { id: 1, name: 'Sarah Chen', role: 'Content Strategist', avatar: 'https://picsum.photos/seed/sarah/100/100' },
    { id: 2, name: 'Marcus Doe', role: 'Lead Designer', avatar: 'https://picsum.photos/seed/marcus/100/100' },
    { id: 3, name: 'Aisha Rahman', role: 'Community Manager', avatar: 'https://picsum.photos/seed/aisha/100/100' },
  ]);

  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Editor');

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);

  const handleSave = () => {
    setProfile(editForm);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditForm(profile);
    setIsEditing(false);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditForm({ ...editForm, avatar: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAccountConnection = (id: string) => {
    setConnectedAccounts(prev => prev.map(acc => {
      if (acc.id === id) {
        return { ...acc, connected: !acc.connected, handle: !acc.connected ? 'user_handle' : '' };
      }
      return acc;
    }));
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    
    const newMember = {
      id: Date.now(),
      name: inviteEmail.split('@')[0],
      role: inviteRole,
      avatar: `https://picsum.photos/seed/${inviteEmail}/100/100`
    };
    
    setTeamMembers([...teamMembers, newMember]);
    setIsInviting(false);
    setInviteEmail('');
  };

  const removeMember = (id: number) => {
    setTeamMembers(teamMembers.filter(m => m.id !== id));
  };

  const stats = [
    { label: 'Total Posts', value: '1,284', trend: '+12%' },
    { label: 'Engagement Rate', value: '4.8%', trend: '+0.6%' },
    { label: 'Total Reach', value: '845K', trend: '+24%' },
    { label: 'Active Campaigns', value: '12', trend: 'Stable' },
  ];

  const tabs = [
    { id: 'profile', label: 'Public Profile', icon: UserIcon },
    { id: 'security', label: 'Security & Access', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2"
      >
        <h1 className="text-3xl font-display font-bold text-white tracking-tight">Account Settings</h1>
        <p className="text-sm text-slate-400">
          Manage your personal details, security preferences, and notifications.
        </p>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full lg:w-64 flex-shrink-0 space-y-2"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeTab === tab.id 
                  ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent'
              }`}
            >
              <tab.icon className={`h-5 w-5 ${activeTab === tab.id ? 'text-indigo-400' : 'text-slate-500'}`} />
              <span className="font-medium">{tab.label}</span>
            </button>
          ))}
        </motion.div>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 xl:grid-cols-3 gap-8"
              >
                {/* Main Profile Column */}
                <div className="xl:col-span-2 space-y-8">
                  <div className="bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-sm">
                    {/* Cover Image */}
                    <div className="h-48 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 relative overflow-hidden">
                      <div className="absolute inset-0 bg-black/10"></div>
                      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
                    </div>
                    
                    <div className="px-8 pb-8">
                      <div className="relative flex justify-between items-end -mt-16 mb-6">
                        <div className="relative h-32 w-32 rounded-full ring-4 ring-slate-900 bg-slate-800 overflow-hidden group shadow-lg">
                          <img 
                            src={profile.avatar} 
                            alt={profile.username} 
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            referrerPolicy="no-referrer"
                          />
                          {isEditing ? (
                            <div 
                              className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center cursor-pointer hover:bg-black/60 transition-colors"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              <Camera className="h-8 w-8 text-white" />
                              <input 
                                type="file" 
                                ref={fileInputRef} 
                                className="hidden" 
                                accept="image/*" 
                                onChange={handleAvatarChange} 
                              />
                            </div>
                          ) : (
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                              <Camera className="h-8 w-8 text-white" />
                            </div>
                          )}
                        </div>
                        
                        {!isEditing && (
                          <button
                            onClick={() => setIsEditing(true)}
                            className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors shadow-sm"
                          >
                            Edit Profile
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div>
                              <label htmlFor="username" className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Username</label>
                              <input
                                type="text"
                                id="username"
                                value={editForm.username}
                                onChange={(e) => setEditForm({...editForm, username: e.target.value})}
                                className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                              />
                            </div>
                            <div>
                              <label htmlFor="role" className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Role</label>
                              <input
                                type="text"
                                id="role"
                                value={editForm.role}
                                onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                                className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                              />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="avatar" className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Avatar URL</label>
                            <input
                              type="text"
                              id="avatar"
                              value={editForm.avatar}
                              onChange={(e) => setEditForm({...editForm, avatar: e.target.value})}
                              className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                            />
                          </div>
                          <div>
                            <label htmlFor="bio" className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Short Bio</label>
                            <textarea
                              id="bio"
                              rows={3}
                              value={editForm.bio}
                              onChange={(e) => setEditForm({...editForm, bio: e.target.value})}
                              className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800 resize-none"
                            />
                          </div>
                          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                            <button
                              onClick={handleCancel}
                              className="inline-flex items-center rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors shadow-sm"
                            >
                              <X className="mr-2 h-4 w-4" />
                              Cancel
                            </button>
                            <button
                              onClick={handleSave}
                              className="inline-flex items-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5 transition-all"
                            >
                              <Save className="mr-2 h-4 w-4" />
                              Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="animate-in fade-in duration-500">
                          <h2 className="text-2xl font-display font-bold text-white">{profile.username}</h2>
                          <p className="text-indigo-400 font-medium mt-1">{profile.role}</p>
                          <p className="mt-4 text-slate-300 leading-relaxed max-w-2xl">{profile.bio}</p>
                          
                          <div className="mt-6 flex flex-wrap gap-4 text-sm text-slate-400">
                            <div className="flex items-center gap-1.5 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                              <MapPin className="h-4 w-4 text-slate-500" />
                              {profile.location}
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                              <Calendar className="h-4 w-4 text-slate-500" />
                              Joined {profile.joined}
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                              <Mail className="h-4 w-4 text-slate-500" />
                              admin@alfardan.com
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Activity Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {stats.map((stat, idx) => (
                      <div key={idx} className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-sm hover:shadow-md transition-shadow hover:border-slate-700">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
                        <p className="mt-2 text-2xl font-display font-bold text-white">{stat.value}</p>
                        <p className={`mt-1 text-xs font-medium ${stat.trend.startsWith('+') ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {stat.trend} this month
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sidebar Column */}
                <div className="space-y-8">
                  {/* Connected Accounts */}
                  <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <LinkIcon className="h-5 w-5 text-indigo-400" />
                      <h3 className="text-lg font-display font-bold text-white">Connected Accounts</h3>
                    </div>
                    
                    <div className="space-y-4">
                      {connectedAccounts.map((account, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:bg-slate-800 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${account.connected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700 text-slate-400'}`}>
                              <account.icon className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-200">{account.name}</p>
                              {account.connected && (
                                <p className="text-xs text-slate-400">{account.handle}</p>
                              )}
                            </div>
                          </div>
                          <button 
                            onClick={() => toggleAccountConnection(account.id)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm ${
                            account.connected 
                              ? 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700' 
                              : 'bg-indigo-600 text-white hover:bg-indigo-500'
                          }`}>
                            {account.connected ? 'Disconnect' : 'Connect'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Team Members */}
                  <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-purple-400" />
                        <h3 className="text-lg font-display font-bold text-white">Team Members</h3>
                      </div>
                      <button className="text-xs font-bold text-indigo-400 hover:text-indigo-300">View All</button>
                    </div>
                    
                    <div className="space-y-4">
                      {teamMembers.map((member, idx) => (
                        <div key={idx} className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <img 
                              src={member.avatar} 
                              alt={member.name} 
                              className="h-10 w-10 rounded-full ring-2 ring-slate-800 group-hover:ring-indigo-500/50 transition-all"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-200">{member.name}</p>
                              <p className="text-xs text-slate-400">{member.role}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => removeMember(member.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      
                      {isInviting ? (
                        <form onSubmit={handleInvite} className="mt-4 p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-3">
                          <input 
                            type="email" 
                            placeholder="Email address" 
                            required
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            className="w-full rounded-lg border-0 py-2 px-3 text-white bg-slate-900 ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
                          />
                          <div className="flex gap-2">
                            <select 
                              value={inviteRole}
                              onChange={(e) => setInviteRole(e.target.value)}
                              className="flex-1 rounded-lg border-0 py-2 px-3 text-white bg-slate-900 ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
                            >
                              <option>Editor</option>
                              <option>Viewer</option>
                              <option>Admin</option>
                            </select>
                            <button type="submit" className="px-3 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-500">
                              Send
                            </button>
                            <button type="button" onClick={() => setIsInviting(false)} className="px-3 py-2 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-600">
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button 
                          onClick={() => setIsInviting(true)}
                          className="w-full mt-4 py-2.5 rounded-xl border-2 border-dashed border-slate-700 text-sm font-bold text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all flex items-center justify-center gap-2"
                        >
                          <span>+ Invite Member</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'security' && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-8 max-w-3xl"
              >
                <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="p-3 bg-indigo-500/10 rounded-xl">
                      <Key className="h-6 w-6 text-indigo-400" />
                    </div>
                    <div>
                      <h2 className="text-xl font-display font-bold text-white">Password</h2>
                      <p className="text-sm text-slate-400">Update your password to keep your account secure.</p>
                    </div>
                  </div>

                  <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setPasswordForm({current: '', new: '', confirm: ''}); }}>
                    <div>
                      <label className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Current Password</label>
                      <input
                        type="password"
                        value={passwordForm.current}
                        onChange={e => setPasswordForm({...passwordForm, current: e.target.value})}
                        className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">New Password</label>
                      <input
                        type="password"
                        value={passwordForm.new}
                        onChange={e => setPasswordForm({...passwordForm, new: e.target.value})}
                        className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Confirm New Password</label>
                      <input
                        type="password"
                        value={passwordForm.confirm}
                        onChange={e => setPasswordForm({...passwordForm, confirm: e.target.value})}
                        className="block w-full rounded-xl border-0 py-2.5 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm transition-colors bg-slate-800"
                      />
                    </div>
                    <div className="pt-4">
                      <button type="submit" className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 transition-colors">
                        Update Password
                      </button>
                    </div>
                  </form>
                </div>

                <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="p-3 bg-purple-500/10 rounded-xl">
                      <Smartphone className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <h2 className="text-xl font-display font-bold text-white">Two-Factor Authentication</h2>
                      <p className="text-sm text-slate-400">Add an extra layer of security to your account.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-5 rounded-2xl bg-slate-800/50 border border-slate-700">
                    <div>
                      <h3 className="text-base font-bold text-white">Authenticator App</h3>
                      <p className="text-sm text-slate-400 mt-1">Use an app like Google Authenticator to generate verification codes.</p>
                    </div>
                    <button 
                      onClick={() => setIs2FAEnabled(!is2FAEnabled)}
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                        is2FAEnabled 
                          ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20' 
                          : 'bg-slate-800 border-slate-600 text-white hover:bg-slate-700'
                      }`}
                    >
                      {is2FAEnabled ? 'Enabled' : 'Enable'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'notifications' && (
              <motion.div
                key="notifications"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-8 max-w-3xl"
              >
                <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="p-3 bg-pink-500/10 rounded-xl">
                      <Bell className="h-6 w-6 text-pink-400" />
                    </div>
                    <div>
                      <h2 className="text-xl font-display font-bold text-white">Notification Preferences</h2>
                      <p className="text-sm text-slate-400">Choose what updates you want to receive.</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {[
                      { id: 'emailAlerts', label: 'Email Alerts', description: 'Receive important updates and security alerts via email.' },
                      { id: 'pushNotifications', label: 'Push Notifications', description: 'Get real-time push notifications in your browser.' },
                      { id: 'weeklyDigest', label: 'Weekly Digest', description: 'A weekly summary of your account activity and stats.' },
                      { id: 'newMentions', label: 'New Mentions', description: 'Notify me when someone mentions me in a comment.' },
                      { id: 'campaignUpdates', label: 'Campaign Updates', description: 'Alerts about the status of your active campaigns.' },
                    ].map((item) => (
                      <div key={item.id} className="flex items-start justify-between p-4 rounded-2xl hover:bg-slate-800/50 transition-colors">
                        <div className="pr-8">
                          <h3 className="text-sm font-bold text-white">{item.label}</h3>
                          <p className="text-sm text-slate-400 mt-1">{item.description}</p>
                        </div>
                        <button
                          onClick={() => toggleNotification(item.id as keyof typeof notifications)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                            notifications[item.id as keyof typeof notifications] ? 'bg-indigo-500' : 'bg-slate-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              notifications[item.id as keyof typeof notifications] ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
