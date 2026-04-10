import { useState } from 'react';
import { useClients } from '../lib/client-context';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2, Check, X, Loader2, Trash2, Edit3, Save } from 'lucide-react';

interface ClientForm {
  name: string;
  industry: string;
  website: string;
  instagramHandle: string;
  primaryColor: string;
}

const EMPTY_FORM: ClientForm = { name: '', industry: '', website: '', instagramHandle: '', primaryColor: '' };

export default function Clients() {
  const { clients, selectedClientId, setSelectedClientId, createClient, updateClient, deleteClient, loading, serverOnline, authenticated, authError, fetchClients } = useClients();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!window.confirm(`Delete client "${name}"? This removes all briefs, calendars, assets and review links for this client. This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteClient(id);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowCreate(true);
  };

  const openEdit = (e: React.MouseEvent, clientId: string) => {
    e.stopPropagation();
    const c = clients.find(c => c.id === clientId);
    if (!c) return;
    setForm({
      name: c.name || '',
      industry: c.industry || '',
      website: c.website || '',
      instagramHandle: c.instagramHandle || '',
      primaryColor: c.primaryColor || '',
    });
    setEditingId(clientId);
    setShowCreate(true);
  };

  const closeForm = () => {
    setShowCreate(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const client = await createClient({
        name: form.name.trim(),
        industry: form.industry.trim() || undefined,
        website: form.website.trim() || undefined,
      });
      setSelectedClientId(client.id);
      closeForm();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !form.name.trim()) return;
    setSaving(true);
    try {
      await updateClient(editingId, {
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        website: form.website.trim() || null,
        instagramHandle: form.instagramHandle.trim() || null,
        primaryColor: form.primaryColor.trim() || null,
      } as any);
      // Refresh from server to be safe — single source of truth
      await fetchClients();
      closeForm();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
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
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" /> New Client
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl bg-[#0c0c0c] border border-white/[0.06] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{editingId ? 'Edit Client' : 'Create Client'}</h2>
              <button onClick={closeForm} className="text-zinc-600 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Client name *"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} placeholder="Industry"
                className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
              <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="Website"
                className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
            </div>
            {editingId && (
              <div className="grid grid-cols-2 gap-3">
                <input value={form.instagramHandle} onChange={e => setForm({ ...form, instagramHandle: e.target.value })} placeholder="Instagram handle"
                  className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
                <input value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} placeholder="Primary color (#RRGGBB)"
                  className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm" />
              </div>
            )}
            <button
              onClick={editingId ? handleSaveEdit : handleCreate}
              disabled={!form.name.trim() || creating || saving}
              className="w-full bg-white text-black py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 cursor-pointer flex items-center justify-center gap-2">
              {(creating || saving)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : editingId
                  ? <><Save className="w-4 h-4" /> Save Changes</>
                  : <>Create Client</>}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {authError && (
        <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
          {authError}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-zinc-600 animate-spin" /></div>
      ) : !authenticated ? (
        <div className="rounded-2xl bg-[#0c0c0c] border border-white/[0.06] py-16 text-center">
          <Building2 className="w-10 h-10 text-red-800 mx-auto mb-3" />
          <p className="text-zinc-400">Backend auth failed</p>
          <p className="text-zinc-600 text-sm mt-1">Start the server: npm run dev:server</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl bg-[#0c0c0c] border border-white/[0.06] py-16 text-center">
          <Building2 className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-500">No clients yet</p>
          <button onClick={openCreate} className="text-sm text-white mt-3 underline cursor-pointer">Create your first client</button>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client, i) => (
            <motion.div key={client.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className={`w-full flex items-center gap-4 rounded-2xl p-4 transition-all text-left ${
                selectedClientId === client.id
                  ? 'bg-white/[0.08] border border-white/[0.15]'
                  : 'bg-[#0c0c0c] border border-white/[0.06] hover:border-white/[0.1]'
              }`}
            >
              <button
                onClick={() => setSelectedClientId(client.id)}
                className="flex flex-1 min-w-0 items-center gap-4 cursor-pointer text-left"
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
              </button>
              <button
                onClick={(e) => openEdit(e, client.id)}
                title="Edit client"
                className="shrink-0 p-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-all cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => handleDelete(e, client.id, client.name)}
                disabled={deletingId === client.id}
                title="Delete client"
                className="shrink-0 p-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/30 transition-all disabled:opacity-50 cursor-pointer"
              >
                {deletingId === client.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Trash2 className="w-4 h-4" />}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
