import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, CampaignContent } from '../lib/store';
import { CheckCircle2, XCircle, RefreshCw, Edit3, Image as ImageIcon, MessageSquare, Hash, LayoutTemplate, ArrowLeft } from 'lucide-react';

export default function ReviewExport() {
  const navigate = useNavigate();
  const { currentBrief, campaignContent, updateCampaignContentStatus } = useStore();

  if (!currentBrief || campaignContent.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">No Campaign Content Found</h2>
        <p className="text-zinc-400 mb-8">Please start by creating a new brief.</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-xl transition-colors"
        >
          Create Brief
        </button>
      </div>
    );
  }

  const handleStatusChange = (id: string, status: 'approved' | 'rejected') => {
    updateCampaignContentStatus(id, status);
  };

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-zinc-400 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Brief
          </button>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-2">Review Campaign</h1>
          <p className="text-zinc-400">Review, approve, or regenerate content for <span className="text-amber-400 font-medium">{currentBrief.clientName}</span></p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex gap-4"
        >
          <div className="bg-[#111] border border-white/10 rounded-xl px-6 py-3 flex items-center gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{campaignContent.length}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Total</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {campaignContent.filter(c => c.status === 'approved').length}
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Approved</div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimatePresence>
          {campaignContent.map((content, index) => (
            <motion.div
              key={content.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`bg-[#111] border rounded-2xl overflow-hidden transition-colors ${
                content.status === 'approved' ? 'border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                content.status === 'rejected' ? 'border-red-500/30 opacity-75' :
                'border-white/10'
              }`}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium text-white">
                    {content.platform}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-400">
                    <LayoutTemplate className="w-3 h-3" />
                    {content.recommendedFormat}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStatusChange(content.id, 'rejected')}
                    className={`p-2 rounded-lg transition-colors ${
                      content.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'text-zinc-500 hover:bg-white/10 hover:text-red-400'
                    }`}
                    title="Reject"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleStatusChange(content.id, 'approved')}
                    className={`p-2 rounded-lg transition-colors ${
                      content.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:bg-white/10 hover:text-emerald-400'
                    }`}
                    title="Approve"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> Visual Concept
                  </h3>
                  <p className="text-white text-sm leading-relaxed bg-black/30 p-4 rounded-xl border border-white/5">
                    {content.visualReference}
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Copy
                  </h3>
                  <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">
                    {content.copy}
                  </p>
                </div>

                {content.caption && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                      <Edit3 className="w-4 h-4" /> Caption
                    </h3>
                    <p className="text-zinc-300 text-sm leading-relaxed">
                      {content.caption}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <Hash className="w-4 h-4" /> Hashtags
                  </h3>
                  <p className="text-amber-400/80 text-sm">
                    {content.hashtags}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex justify-end gap-3">
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
