import { useState } from 'react';
import { useClients } from '../lib/client-context';
import { motion } from 'framer-motion';
import { Plus, Building2, Check, X, Loader2 } from 'lucide-react';

export default function Clients() {
  const { clients, selectedClientId, setSelectedClientId, createClient, loading, serverOnline } = useClients();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', industry: '', website: '' });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const client = await createClient(form);
      setSelectedClientId(client.id);
      setForm({ name: '', industry: '', website: '' });
      setShowCreate(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Clients</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {clients.length} client{clients.length !== 1 ? 's' : ''} {serverOnline ? '(synced with server)' : '(local mode)'}
            </p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" /> New Client
          </button>
        </div>
      </motion.div>

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-[#0c0c0c] border border-white/[0.06] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Create Client</h2>
            <button onClick={() => setShowCreate(false)} className="text-zinc-600 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Client name *"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} placeholder="Industry"
              className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
            <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="Website"
              className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
          </div>
          <button onClick={handleCreate} disabled={!form.name.trim() || creating}
            className="w-full bg-white text-black py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 cursor-pointer">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create Client'}
          </button>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-zinc-600 animate-spin" /></div>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl bg-[#0c0c0c] border border-white/[0.06] py-16 text-center">
          <Building2 className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-500">No clients yet</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-white mt-3 underline cursor-pointer">Create your first client</button>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client, i) => (
            <motion.button key={client.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedClientId(client.id)}
              className={`w-full flex items-center gap-4 rounded-2xl p-4 transition-all cursor-pointer text-left ${
                selectedClientId === client.id
                  ? 'bg-white/[0.08] border border-white/[0.15]'
                  : 'bg-[#0c0c0c] border border-white/[0.06] hover:border-white/[0.1]'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
                <Building2 className={`w-5 h-5 ${selectedClientId === client.id ? 'text-white' : 'text-zinc-600'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{client.name}</p>
                <p className="text-[11px] text-zinc-600">{client.industry || 'No industry'} {client.website ? `· ${client.website}` : ''}</p>
              </div>
              {selectedClientId === client.id && (
                <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              )}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
