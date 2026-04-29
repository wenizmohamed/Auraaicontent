import { useState, DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, CheckCircle2, Clock, XCircle, BarChart3, 
  Users, Eye, ThumbsUp, Plus, MessageSquare, 
  Calendar as CalendarIcon, X, Send, Search
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie
} from 'recharts';
import { useStore, PipelineItem, PipelineStatus } from '../lib/store';
import { motionUI } from '../lib/motion';

type Tab = 'pipeline' | 'approvals' | 'analytics';

const COLUMNS: { id: PipelineStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'in-review', label: 'In Review' },
  { id: 'needs-revision', label: 'Needs Revision' },
  { id: 'approved', label: 'Approved' },
  { id: 'published', label: 'Published' }
];

const PLATFORMS = ['LinkedIn', 'Instagram', 'Twitter', 'TikTok', 'Facebook', 'Blog'];
const PRIORITIES = ['low', 'medium', 'high'] as const;

export default function Studio() {
  const { pipelineItems, addPipelineItem, updateItemStatus, addComment, getStats } = useStore();
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  
  // Modals state
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null);
  
  // New Item Form State
  const [newItemForm, setNewItemForm] = useState({
    title: '',
    description: '',
    platform: 'LinkedIn',
    dueDate: '',
    assignee: 'Current User',
    priority: 'medium' as 'low' | 'medium' | 'high'
  });

  // Approval Form State
  const [approvalComment, setApprovalComment] = useState('');

  // Detail Modal Comment State
  const [detailComment, setDetailComment] = useState('');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Drag and Drop handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>, itemId: string) => {
    e.dataTransfer.setData('itemId', itemId);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, status: PipelineStatus) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('itemId');
    if (itemId) {
      updateItemStatus(itemId, status);
    }
  };

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    addPipelineItem({ ...newItemForm, status: 'draft' });
    setIsNewItemModalOpen(false);
    setNewItemForm({
      title: '', description: '', platform: 'LinkedIn', dueDate: '', assignee: 'Current User', priority: 'medium'
    });
  };

  const handleAddDetailComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItem && detailComment.trim()) {
      addComment(selectedItem.id, detailComment, 'Current User');
      setDetailComment('');
      // Update selected item to reflect new comment
      const updatedItem = pipelineItems.find(i => i.id === selectedItem.id);
      if (updatedItem) setSelectedItem(updatedItem);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'medium': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'low': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'Instagram': return 'bg-pink-500/20 text-pink-400';
      case 'LinkedIn': return 'bg-blue-500/20 text-blue-400';
      case 'TikTok': return 'bg-teal-500/20 text-teal-400';
      case 'Twitter': return 'bg-sky-500/20 text-sky-400';
      case 'Facebook': return 'bg-indigo-500/20 text-indigo-400';
      default: return 'bg-purple-500/20 text-purple-400';
    }
  };

  const renderPipeline = () => {
    const filteredItems = pipelineItems.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      item.platform.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="relative w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-400" />
            </div>
            <input
              type="text"
              placeholder="Filter by title or platform..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-xl bg-black/40 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500 transition-colors"
            />
          </div>
          <button 
            onClick={() => setIsNewItemModalOpen(true)}
            className="inline-flex items-center px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-fuchsia-500/20"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Content
          </button>
        </div>
        
        <div className="flex gap-6 overflow-x-auto pb-4 custom-scrollbar snap-x">
          {COLUMNS.map((col) => {
            const items = filteredItems.filter(i => i.status === col.id);
            return (
              <div 
                key={col.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
                className="bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col min-w-[300px] w-[300px] h-[650px] shrink-0 snap-center"
              >
                <div className="flex items-center justify-between mb-4 px-2">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    {col.label}
                  </h3>
                  <span className="bg-white/10 text-zinc-400 text-xs px-2 py-1 rounded-full">
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {items.map(item => (
                    <div 
                      key={item.id} 
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onClick={() => setSelectedItem(item)}
                      className="bg-black/40 p-4 rounded-xl border border-white/5 hover:border-white/20 transition-colors cursor-grab active:cursor-grabbing group"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${getPlatformColor(item.platform)}`}>
                          {item.platform}
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${getPriorityColor(item.priority)}`}>
                          {item.priority}
                        </span>
                      </div>
                      <h4 className="text-sm font-medium text-zinc-200 mb-3 line-clamp-2">{item.title}</h4>
                      
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                          <div className="flex items-center" title="Due Date">
                            <CalendarIcon className="w-3 h-3 mr-1" />
                            {new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </div>
                          {item.comments.length > 0 && (
                            <div className="flex items-center" title="Comments">
                              <MessageSquare className="w-3 h-3 mr-1" />
                              {item.comments.length}
                            </div>
                          )}
                        </div>
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white shadow-sm" title={item.assignee}>
                          {item.assignee.split(' ').map(n => n[0]).join('')}
                        </div>
                      </div>
                      {col.id === 'published' && (
                        <button className="mt-4 w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-zinc-300 transition-colors flex items-center justify-center">
                          <Eye className="w-3 h-3 mr-1.5" />
                          View Post
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderApprovals = () => {
    const inReviewItems = pipelineItems.filter(i => i.status === 'in-review');
    
    // Create a history log from comments on approved/needs-revision items
    const historyLog = pipelineItems
      .filter(i => i.status === 'approved' || i.status === 'needs-revision')
      .flatMap(item => 
        item.comments.map(c => ({
          id: c.id,
          itemTitle: item.title,
          action: item.status === 'approved' ? 'approved' : 'rejected',
          author: c.author,
          comment: c.text,
          date: c.timestamp
        }))
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-lg font-display font-bold text-white">Pending Approvals</h3>
          {inReviewItems.length === 0 ? (
            <div className="bg-white/5 rounded-3xl p-8 border border-white/10 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50" />
              <p className="text-zinc-400">All caught up! No items pending approval.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {inReviewItems.map(item => (
                <div key={item.id} className="bg-white/5 rounded-2xl border border-white/10 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${getPlatformColor(item.platform)}`}>
                          {item.platform}
                        </span>
                        <span className="text-xs text-zinc-500 flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          Due: {new Date(item.dueDate).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="text-lg font-medium text-white">{item.title}</h4>
                      <p className="text-sm text-zinc-400 mt-1">{item.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-zinc-300">{item.assignee}</div>
                      <div className="text-xs text-zinc-500">Author</div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-6 border-t border-white/10">
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Approval Feedback</label>
                    <textarea 
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-fuchsia-500 outline-none resize-none mb-4"
                      rows={2}
                      placeholder="Add comments before approving or rejecting..."
                      value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)}
                    />
                    <div className="flex justify-end gap-3">
                      <button 
                        onClick={() => {
                          if (approvalComment) addComment(item.id, approvalComment, 'Current User');
                          updateItemStatus(item.id, 'needs-revision');
                          setApprovalComment('');
                        }}
                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm font-medium transition-colors border border-red-500/20"
                      >
                        Needs Revision
                      </button>
                      <button 
                        onClick={() => {
                          if (approvalComment) addComment(item.id, approvalComment, 'Current User');
                          updateItemStatus(item.id, 'approved');
                          setApprovalComment('');
                        }}
                        className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl text-sm font-medium transition-colors border border-emerald-500/20"
                      >
                        Approve Content
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div>
          <h3 className="text-lg font-display font-bold text-white mb-6">Approval History</h3>
          <div className="bg-white/5 rounded-3xl p-6 border border-white/10 max-h-[600px] overflow-y-auto custom-scrollbar">
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
              {historyLog.map((log) => (
                <div key={log.id} className="relative flex items-start gap-4">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#0a0a0a] bg-white/5 shrink-0 z-10 ${
                    log.action === 'approved' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {log.action === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 pt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-zinc-200">{log.itemTitle}</span>
                      <span className="text-xs text-zinc-500">{new Date(log.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2">
                      <span className={log.action === 'approved' ? 'text-emerald-400' : 'text-red-400'}>
                        {log.action === 'approved' ? 'Approved' : 'Rejected'}
                      </span> by {log.author}
                    </p>
                    {log.comment && (
                      <div className="bg-black/40 rounded-lg p-3 text-sm text-zinc-300 border border-white/5">
                        "{log.comment}"
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {historyLog.length === 0 && (
                <p className="text-sm text-zinc-500 text-center py-4">No recent approval history.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAnalytics = () => {
    const appStats = getStats();
    
    const totalItems = pipelineItems.length;
    const pendingReview = pipelineItems.filter(i => i.status === 'in-review').length;
    
    // Compute platform distribution
    const platformCounts = pipelineItems.reduce((acc, item) => {
      acc[item.platform] = (acc[item.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const chartData = Object.entries(platformCounts).map(([name, value]) => {
      let color = '#a855f7'; // default purple
      if (name === 'Instagram') color = '#ec4899';
      if (name === 'LinkedIn') color = '#3b82f6';
      if (name === 'TikTok') color = '#14b8a6';
      if (name === 'Twitter') color = '#0ea5e9';
      if (name === 'Facebook') color = '#6366f1';
      return { name, value, color };
    });

    // Compute status distribution
    const statusCounts = pipelineItems.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const statusChartData = COLUMNS.map(col => {
      let color = '#71717a'; // draft - zinc
      if (col.id === 'in-review') color = '#3b82f6'; // blue
      if (col.id === 'needs-revision') color = '#f59e0b'; // amber
      if (col.id === 'approved') color = '#10b981'; // emerald
      if (col.id === 'published') color = '#a855f7'; // purple
      return {
        name: col.label,
        value: statusCounts[col.id] || 0,
        color
      };
    }).filter(item => item.value > 0);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full -z-10 opacity-50 group-hover:opacity-100 transition-opacity" />
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <p className="text-sm text-zinc-400 font-medium mb-1">Total Pipeline Items</p>
            <h4 className="text-2xl font-display font-bold text-white">{totalItems}</h4>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.1 }}
            className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full -z-10 opacity-50 group-hover:opacity-100 transition-opacity" />
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-sm text-zinc-400 font-medium mb-1">Approval Rate</p>
            <h4 className="text-2xl font-display font-bold text-white">{appStats.approvalRate}%</h4>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.2 }}
            className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full -z-10 opacity-50 group-hover:opacity-100 transition-opacity" />
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
              <Clock className="w-5 h-5" />
            </div>
            <p className="text-sm text-zinc-400 font-medium mb-1">In Review</p>
            <h4 className="text-2xl font-display font-bold text-white">{pendingReview}</h4>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.3 }}
            className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full -z-10 opacity-50 group-hover:opacity-100 transition-opacity" />
            <div className="w-10 h-10 rounded-xl bg-pink-500/20 text-pink-400 flex items-center justify-center mb-4">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <p className="text-sm text-zinc-400 font-medium mb-1">Due This Month</p>
            <h4 className="text-2xl font-display font-bold text-white">{appStats.postsThisMonth}</h4>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.4 }}
            className="bg-white/5 rounded-3xl p-8 border border-white/10"
          >
            <h3 className="text-lg font-display font-bold text-white mb-6">Platform Distribution</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#a1a1aa" tick={{ fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{ fill: '#ffffff05' }}
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff' }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.5 }}
            className="bg-white/5 rounded-3xl p-8 border border-white/10"
          >
            <h3 className="text-lg font-display font-bold text-white mb-6">Pipeline Status</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 shadow-2xl border border-slate-800"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 via-pink-500/5 to-transparent z-0" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-fuchsia-500/20 rounded-full blur-3xl z-0" />
        
        <div className="relative z-10 flex items-center gap-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-lg shadow-fuchsia-500/20">
            <LayoutDashboard className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
              Content Studio
            </h1>
            <p className="text-slate-300 text-lg">
              Manage your pipeline, review approvals, and track performance.
            </p>
          </div>
        </div>
      </motion.div>

      <div className="flex space-x-1 bg-white/5 p-1 rounded-xl border border-white/10 w-fit">
        {[
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'approvals', label: 'Approvals' },
          { id: 'analytics', label: 'Analytics' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {activeTab === 'pipeline' && renderPipeline()}
        {activeTab === 'approvals' && renderApprovals()}
        {activeTab === 'analytics' && renderAnalytics()}
      </div>

      {/* New Item Modal */}
      <AnimatePresence>
        {isNewItemModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <h2 className="text-xl font-display font-bold text-white">New Content Item</h2>
                <button onClick={() => setIsNewItemModalOpen(false)} className="text-zinc-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleCreateItem} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Title</label>
                  <input required type="text" value={newItemForm.title} onChange={e => setNewItemForm({...newItemForm, title: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none" placeholder="e.g., Q3 Campaign Teaser" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Description</label>
                  <textarea required value={newItemForm.description} onChange={e => setNewItemForm({...newItemForm, description: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none resize-none" rows={3} placeholder="Brief description of the content..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Platform</label>
                    <select value={newItemForm.platform} onChange={e => setNewItemForm({...newItemForm, platform: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none [&>option]:bg-slate-900">
                      {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Priority</label>
                    <select value={newItemForm.priority} onChange={e => setNewItemForm({...newItemForm, priority: e.target.value as any})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none [&>option]:bg-slate-900">
                      {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Assignee</label>
                    <input required type="text" value={newItemForm.assignee} onChange={e => setNewItemForm({...newItemForm, assignee: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none" placeholder="e.g., Sarah J." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Due Date</label>
                    <input required type="date" value={newItemForm.dueDate} onChange={e => setNewItemForm({...newItemForm, dueDate: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none [color-scheme:dark]" />
                  </div>
                </div>
                <div className="pt-4 flex justify-end gap-3">
                  <button type="button" onClick={() => setIsNewItemModalOpen(false)} className="px-4 py-2 text-zinc-400 hover:text-white transition-colors">Cancel</button>
                  <button type="submit" className="px-6 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl font-medium transition-colors">Create Item</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 rounded-3xl border border-slate-800 w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-start bg-white/5 shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md ${getPlatformColor(selectedItem.platform)}`}>
                      {selectedItem.platform}
                    </span>
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${getPriorityColor(selectedItem.priority)}`}>
                      {selectedItem.priority} Priority
                    </span>
                    <span className="text-xs text-zinc-400 px-2 py-1 bg-black/40 rounded-md border border-white/5">
                      {COLUMNS.find(c => c.id === selectedItem.status)?.label}
                    </span>
                  </div>
                  <h2 className="text-2xl font-display font-bold text-white">{selectedItem.title}</h2>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-zinc-400 hover:text-white transition-colors p-1 bg-black/40 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-8">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Description</h4>
                    <p className="text-sm text-zinc-300 leading-relaxed">{selectedItem.description}</p>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Assignee</h4>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white">
                          {selectedItem.assignee.split(' ').map(n => n[0]).join('')}
                        </div>
                        <span className="text-sm text-zinc-300">{selectedItem.assignee}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Due Date</h4>
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <CalendarIcon className="w-4 h-4 text-zinc-400" />
                        {new Date(selectedItem.dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                    <MessageSquare className="w-4 h-4 mr-2 text-zinc-400" />
                    Comments & Activity
                  </h4>
                  
                  <div className="space-y-4 mb-6">
                    {selectedItem.comments.map(comment => (
                      <div key={comment.id} className="bg-black/40 rounded-xl p-4 border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-zinc-200">{comment.author}</span>
                          <span className="text-xs text-zinc-500">{new Date(comment.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-zinc-400">{comment.text}</p>
                      </div>
                    ))}
                    {selectedItem.comments.length === 0 && (
                      <p className="text-sm text-zinc-500 italic">No comments yet.</p>
                    )}
                  </div>

                  <form onSubmit={handleAddDetailComment} className="relative">
                    <input 
                      type="text" 
                      value={detailComment}
                      onChange={e => setDetailComment(e.target.value)}
                      placeholder="Add a comment..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm text-white focus:ring-2 focus:ring-fuchsia-500 outline-none"
                    />
                    <button 
                      type="submit"
                      disabled={!detailComment.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg disabled:opacity-50 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>
              
              <div className="p-4 border-t border-white/10 bg-black/40 shrink-0 flex justify-between items-center">
                <div className="flex gap-2">
                  <select 
                    value={selectedItem.status}
                    onChange={(e) => {
                      updateItemStatus(selectedItem.id, e.target.value as PipelineStatus);
                      setSelectedItem({...selectedItem, status: e.target.value as PipelineStatus});
                    }}
                    className="bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none [&>option]:bg-slate-900"
                  >
                    {COLUMNS.map(c => <option key={c.id} value={c.id}>Move to {c.label}</option>)}
                  </select>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
