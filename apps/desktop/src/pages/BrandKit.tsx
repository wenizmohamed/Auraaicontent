// BrandKit page — Wave 2.A, 2026-05-12.
// Per-client brand identity (visual, voice, anchors) with on-save version
// snapshots. Reuses Radix amber + glass-card vocabulary from Profile.tsx.
//
// Note: design-system spec called for the generator's red+Playfair palette but
// the parent spec locks Radix amber+Inter — that vocabulary wins. (Spec #4.)

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Type, MessageSquare, Image as ImageIcon, Save, Loader2,
  Plus, Trash2, Check, AlertCircle, History as HistoryIcon, Star, ShieldAlert,
} from 'lucide-react';
import { useClients } from '../lib/client-context';
import {
  brandKitApi,
  type BrandKitRecord,
  type BrandKitVoiceSample,
  type BrandKitSampleImage,
  type BrandKitVersionRecord,
} from '../lib/backend-api';
import { motionBase, motionInstant, motionUI } from '../lib/motion';

// ── Constants ────────────────────────────────────────────────────────

const PLATFORMS = ['general', 'instagram', 'linkedin', 'tiktok', 'x', 'email'] as const;
type PlatformId = typeof PLATFORMS[number];

const SAMPLE_IMAGE_SLOTS = 5;

const DEFAULT_VOICE_SAMPLE: BrandKitVoiceSample = { context: 'general', sample: '' };
const DEFAULT_SAMPLE_IMAGE: BrandKitSampleImage = { url: '', label: '', primary: false };

// ── Types ────────────────────────────────────────────────────────────

type ToastKind = 'success' | 'error';
interface Toast { kind: ToastKind; msg: string; }

interface BrandKitFormState {
  secondaryColor: string;
  accentColor: string;
  fontPrimary: string;
  fontSecondary: string;
  voiceSamples: BrandKitVoiceSample[];
  voiceDoNotRules: string[];
  voicePerPlatform: Record<string, string>;
  sampleImages: BrandKitSampleImage[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeRules(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string');
  if (value && typeof value === 'object' && Array.isArray((value as any).rules)) {
    return (value as any).rules.filter((v: any) => typeof v === 'string');
  }
  return [];
}

function emptyForm(): BrandKitFormState {
  return {
    secondaryColor: '',
    accentColor: '',
    fontPrimary: '',
    fontSecondary: '',
    voiceSamples: [{ ...DEFAULT_VOICE_SAMPLE }],
    voiceDoNotRules: [],
    voicePerPlatform: {},
    sampleImages: Array.from({ length: SAMPLE_IMAGE_SLOTS }, () => ({ ...DEFAULT_SAMPLE_IMAGE })),
  };
}

function hydrateForm(kit: BrandKitRecord | null): BrandKitFormState {
  const base = emptyForm();
  if (!kit) return base;
  const samples = Array.isArray(kit.voiceSamples) && kit.voiceSamples.length > 0
    ? kit.voiceSamples.map(s => ({ context: s.context || 'general', sample: s.sample || '' }))
    : base.voiceSamples;
  const images = Array.from({ length: SAMPLE_IMAGE_SLOTS }, (_, i) => {
    const src = kit.sampleImages?.[i];
    return src
      ? { url: src.url || '', label: src.label || '', primary: !!src.primary, mimeType: src.mimeType }
      : { ...DEFAULT_SAMPLE_IMAGE };
  });
  return {
    secondaryColor: kit.secondaryColor || '',
    accentColor: kit.accentColor || '',
    fontPrimary: kit.fontPrimary || '',
    fontSecondary: kit.fontSecondary || '',
    voiceSamples: samples,
    voiceDoNotRules: normalizeRules(kit.voiceDoNot),
    voicePerPlatform: (kit.voicePerPlatform as any) || {},
    sampleImages: images,
  };
}

function isValidHex(v: string): boolean {
  if (!v) return true; // empty is fine (clears the field)
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v);
}

// ── Page ─────────────────────────────────────────────────────────────

export default function BrandKit() {
  const { clients, selectedClientId, setSelectedClientId, currentClient } = useClients();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kit, setKit] = useState<BrandKitRecord | null>(null);
  const [versions, setVersions] = useState<BrandKitVersionRecord[]>([]);
  const [clientPrimaryColor, setClientPrimaryColor] = useState<string | null>(null);
  const [form, setForm] = useState<BrandKitFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  // ── Fetch on client change ──────────────────────────────────────
  const loadKit = useCallback(async () => {
    if (!selectedClientId) {
      setKit(null);
      setVersions([]);
      setForm(emptyForm());
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [kitRes, versionsRes] = await Promise.all([
        brandKitApi.get(selectedClientId),
        brandKitApi.listVersions(selectedClientId).catch(() => [] as BrandKitVersionRecord[]),
      ]);
      setKit(kitRes.brandKit);
      setClientPrimaryColor(kitRes.clientPrimaryColor);
      setForm(hydrateForm(kitRes.brandKit));
      setVersions(versionsRes);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load brand kit');
    } finally {
      setLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => { loadKit(); }, [loadKit]);

  // ── Toast auto-dismiss ──────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Form helpers ────────────────────────────────────────────────
  const setField = useCallback(<K extends keyof BrandKitFormState>(key: K, val: BrandKitFormState[K]) => {
    setForm(f => ({ ...f, [key]: val }));
  }, []);

  const addVoiceSample = () => setField('voiceSamples', [...form.voiceSamples, { ...DEFAULT_VOICE_SAMPLE }]);
  const updateVoiceSample = (idx: number, patch: Partial<BrandKitVoiceSample>) =>
    setField('voiceSamples', form.voiceSamples.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const removeVoiceSample = (idx: number) =>
    setField('voiceSamples', form.voiceSamples.filter((_, i) => i !== idx));

  const addDoNotRule = () => setField('voiceDoNotRules', [...form.voiceDoNotRules, '']);
  const updateDoNotRule = (idx: number, val: string) =>
    setField('voiceDoNotRules', form.voiceDoNotRules.map((r, i) => (i === idx ? val : r)));
  const removeDoNotRule = (idx: number) =>
    setField('voiceDoNotRules', form.voiceDoNotRules.filter((_, i) => i !== idx));

  const updateImage = (idx: number, patch: Partial<BrandKitSampleImage>) =>
    setField('sampleImages', form.sampleImages.map((img, i) => {
      if (i !== idx) {
        // Only one primary allowed — clear others when one is set
        if (patch.primary) return { ...img, primary: false };
        return img;
      }
      return { ...img, ...patch };
    }));

  const updatePlatformVoice = (platform: PlatformId, val: string) =>
    setField('voicePerPlatform', { ...form.voicePerPlatform, [platform]: val });

  // ── Validation ──────────────────────────────────────────────────
  const hexErrors = useMemo(() => ({
    secondary: !isValidHex(form.secondaryColor),
    accent: !isValidHex(form.accentColor),
  }), [form.secondaryColor, form.accentColor]);

  const formInvalid = hexErrors.secondary || hexErrors.accent;

  // ── Save ────────────────────────────────────────────────────────
  async function save() {
    if (!selectedClientId || saving || formInvalid) return;
    setSaving(true);
    try {
      // Strip empty voice samples + image slots before persisting
      const cleanedSamples = form.voiceSamples
        .filter(s => (s.sample || '').trim().length > 0)
        .map(s => ({ context: s.context || 'general', sample: (s.sample || '').trim() }));
      const cleanedImages = form.sampleImages
        .filter(img => (img.url || '').trim().length > 0)
        .map(img => ({
          url: img.url.trim(),
          label: (img.label || '').trim() || undefined,
          primary: !!img.primary,
          mimeType: img.mimeType,
        }));
      const cleanedRules = form.voiceDoNotRules.map(r => r.trim()).filter(r => r.length > 0);
      const cleanedPlatforms = Object.fromEntries(
        Object.entries(form.voicePerPlatform)
          .filter(([, v]) => (v || '').trim().length > 0)
          .map(([k, v]) => [k, v.trim()]),
      );

      const updated = await brandKitApi.upsert(selectedClientId, {
        secondaryColor: form.secondaryColor.trim() || null,
        accentColor: form.accentColor.trim() || null,
        fontPrimary: form.fontPrimary.trim() || null,
        fontSecondary: form.fontSecondary.trim() || null,
        voiceSamples: cleanedSamples,
        voiceDoNot: cleanedRules.length > 0 ? { rules: cleanedRules } : null,
        voicePerPlatform: Object.keys(cleanedPlatforms).length > 0 ? cleanedPlatforms : null,
        sampleImages: cleanedImages,
      });
      setKit(updated);
      setToast({ kind: 'success', msg: `Saved — v${updated.version}` });
      // Re-fetch versions (the prior state was just snapshotted)
      brandKitApi.listVersions(selectedClientId).then(setVersions).catch(() => {});
    } catch (err: any) {
      setToast({ kind: 'error', msg: err?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedClientId || !kit) return;
    if (!deleteArmed) { setDeleteArmed(true); return; }
    try {
      await brandKitApi.delete(selectedClientId);
      setKit(null);
      setVersions([]);
      setForm(emptyForm());
      setDeleteArmed(false);
      setToast({ kind: 'success', msg: 'Brand kit deleted' });
    } catch (err: any) {
      setToast({ kind: 'error', msg: err?.message || 'Delete failed' });
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-[color:var(--color-accent)]" />
          <p className="text-sm text-zinc-500">Loading brand kit…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      {/* ── Header + client picker ─────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionBase}
        className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--color-fg-subtle)' }}>
            Manage · Brand
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-white flex items-center gap-2.5">
            <Palette className="w-6 h-6 text-[color:var(--color-accent)]" />
            Brand Kit
          </h1>
          <p className="text-sm text-zinc-400 mt-1.5 max-w-xl">
            Per-client visual identity, voice and anchor imagery. Every save is versioned —
            you can roll back to any prior snapshot.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="bk-client" className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">Client</label>
            <select
              id="bk-client"
              value={selectedClientId || ''}
              onChange={e => setSelectedClientId(e.target.value)}
              className="cursor-pointer rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white focus:border-[color:var(--color-accent)]/50 focus:outline-none min-w-[200px]"
            >
              {clients.length === 0 && <option value="">No clients</option>}
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {kit && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[color:var(--color-accent-subtle)] text-[color:var(--color-accent)] border border-[color:var(--color-accent)]/30 text-xs font-medium">
              v{kit.version}
            </span>
          )}
        </div>
      </motion.header>

      {loadError && (
        <div className="mb-5 p-3.5 rounded-xl bg-[color:var(--color-danger-subtle)] border border-[color:var(--color-danger)]/20 text-sm text-[color:var(--color-danger)] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* ── Brand Identity Showcase — high-contrast live preview ─── */}
      {selectedClientId && (
        <BrandIdentityShowcase
          clientName={currentClient?.name || 'Untitled client'}
          primary={clientPrimaryColor || '#f59e0b'}
          secondary={form.secondaryColor || '#27272a'}
          accent={form.accentColor || '#f59e0b'}
          fontPrimary={form.fontPrimary || 'Inter'}
          fontSecondary={form.fontSecondary || 'Playfair Display'}
          voiceSample={form.voiceSamples.find(v => v.sample?.trim())?.sample || ''}
          sampleImages={form.sampleImages.filter(i => i.url?.trim()).slice(0, 5)}
          version={kit?.version || 1}
        />
      )}

      {!selectedClientId ? (
        <div className="glass-card p-10 text-center">
          <p className="text-zinc-400 text-sm">Select a client to configure their brand kit.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* ── Form column ───────────────────────────────────── */}
          <div className="space-y-5">
            {/* Visual identity */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionBase}
              className="glass-card p-6 shadow-sm"
              aria-labelledby="bk-visual"
            >
              <h2 id="bk-visual" className="text-base font-display font-semibold text-white flex items-center gap-2">
                <Palette className="w-4 h-4 text-[color:var(--color-accent)]" />
                Visual identity
              </h2>
              <p className="text-xs text-zinc-500 mt-1">Primary color is locked from Client settings.</p>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <ColorSwatchField
                  id="bk-primary"
                  label="Primary"
                  value={clientPrimaryColor || ''}
                  readOnly
                  helper="From Client"
                />
                <ColorSwatchField
                  id="bk-secondary"
                  label="Secondary"
                  value={form.secondaryColor}
                  onChange={v => setField('secondaryColor', v)}
                  error={hexErrors.secondary ? 'Invalid hex' : null}
                />
                <ColorSwatchField
                  id="bk-accent"
                  label="Accent"
                  value={form.accentColor}
                  onChange={v => setField('accentColor', v)}
                  error={hexErrors.accent ? 'Invalid hex' : null}
                />
              </div>

              <h3 className="mt-6 text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5" />
                Typography
              </h3>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  id="bk-font-primary"
                  label="Primary font"
                  placeholder="e.g. Inter, Manrope"
                  value={form.fontPrimary}
                  onChange={v => setField('fontPrimary', v)}
                />
                <TextField
                  id="bk-font-secondary"
                  label="Secondary font"
                  placeholder="e.g. Playfair Display, Fraunces"
                  value={form.fontSecondary}
                  onChange={v => setField('fontSecondary', v)}
                />
              </div>
            </motion.section>

            {/* Voice */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionBase, delay: 0.05 }}
              className="glass-card p-6 shadow-sm"
              aria-labelledby="bk-voice"
            >
              <h2 id="bk-voice" className="text-base font-display font-semibold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[color:var(--color-accent)]" />
                Voice
              </h2>
              <p className="text-xs text-zinc-500 mt-1">Voice training needs volume — 5+ samples per platform yields the best calibration.</p>

              {/* Per-platform voice instructions */}
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">Per-platform tone</h3>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PLATFORMS.map(p => (
                  <div key={p}>
                    <label htmlFor={`bk-platform-${p}`} className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">{p}</label>
                    <input
                      id={`bk-platform-${p}`}
                      type="text"
                      value={form.voicePerPlatform[p] || ''}
                      onChange={e => updatePlatformVoice(p, e.target.value)}
                      placeholder={p === 'linkedin' ? 'professional, considered' : p === 'tiktok' ? 'punchy, lowercase' : 'casual, friendly'}
                      className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors"
                    />
                  </div>
                ))}
              </div>

              {/* Voice samples (repeating) */}
              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Voice samples</h3>
                <button
                  type="button"
                  onClick={addVoiceSample}
                  className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add sample
                </button>
              </div>
              <div className="mt-3 space-y-2.5">
                {form.voiceSamples.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <select
                      value={s.context || 'general'}
                      onChange={e => updateVoiceSample(i, { context: e.target.value })}
                      className="cursor-pointer rounded-lg bg-white/[0.04] border border-white/[0.08] px-2.5 py-2 text-xs text-zinc-300 focus:border-[color:var(--color-accent)]/50 focus:outline-none min-w-[110px]"
                    >
                      {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <textarea
                      value={s.sample || ''}
                      onChange={e => updateVoiceSample(i, { sample: e.target.value })}
                      placeholder="Paste a real on-brand caption / paragraph…"
                      rows={2}
                      className="flex-1 rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors resize-y min-h-[60px]"
                    />
                    {form.voiceSamples.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeVoiceSample(i)}
                        aria-label="Remove sample"
                        className="cursor-pointer p-2 rounded-lg text-zinc-500 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-subtle)] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Do-not rules */}
              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Voice "do not" rules
                </h3>
                <button
                  type="button"
                  onClick={addDoNotRule}
                  className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add rule
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {form.voiceDoNotRules.length === 0 && (
                  <p className="text-xs text-zinc-600 italic">No rules yet — e.g. "Never use gradients", "Avoid emoji in headlines".</p>
                )}
                {form.voiceDoNotRules.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={r}
                      onChange={e => updateDoNotRule(i, e.target.value)}
                      placeholder="e.g. Never use gradients in product shots"
                      className="flex-1 rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => removeDoNotRule(i)}
                      aria-label="Remove rule"
                      className="cursor-pointer p-2 rounded-lg text-zinc-500 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-subtle)] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.section>

            {/* Visual anchors */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionBase, delay: 0.1 }}
              className="glass-card p-6 shadow-sm"
              aria-labelledby="bk-anchors"
            >
              <h2 id="bk-anchors" className="text-base font-display font-semibold text-white flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[color:var(--color-accent)]" />
                Visual anchors
              </h2>
              <p className="text-xs text-zinc-500 mt-1">5 reference images that exemplify the brand. One is "primary" (used as cover thumbnail).</p>

              <div className="mt-5 space-y-3">
                {form.sampleImages.map((img, i) => (
                  <SampleImageRow
                    key={i}
                    index={i}
                    image={img}
                    onChange={patch => updateImage(i, patch)}
                  />
                ))}
              </div>
            </motion.section>

            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || formInvalid}
                  className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[color:var(--color-accent)] text-zinc-900 text-sm font-medium hover:bg-[color:var(--color-accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {kit ? 'Save changes' : 'Create brand kit'}
                </button>
                {kit && (
                  <span className="text-xs text-zinc-500">Saving creates v{kit.version + 1}</span>
                )}
              </div>
              {kit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`cursor-pointer text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
                    deleteArmed
                      ? 'bg-[color:var(--color-danger-subtle)] text-[color:var(--color-danger)] border border-[color:var(--color-danger)]/40 hover:bg-[color:var(--color-danger-subtle)]'
                      : 'bg-white/[0.04] hover:bg-[color:var(--color-danger-subtle)] text-zinc-500 hover:text-[color:var(--color-danger)] border border-transparent'
                  }`}
                >
                  {deleteArmed ? 'Click again to confirm delete' : 'Delete brand kit'}
                </button>
              )}
            </div>
          </div>

          {/* ── Version history sidebar ────────────────────────── */}
          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...motionBase, delay: 0.15 }}
            className="lg:sticky lg:top-4 self-start"
          >
            <div className="glass-card p-5 shadow-sm">
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-4 h-4 text-[color:var(--color-accent)]" />
                Version history
              </h2>
              <p className="text-xs text-zinc-500 mt-1">Last 5 snapshots</p>

              <div className="mt-4 space-y-2">
                {versions.length === 0 && (
                  <p className="text-xs text-zinc-600 italic">No saved versions yet.</p>
                )}
                {versions.slice(0, 5).map(v => (
                  <div
                    key={v.id}
                    className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-200">v{v.version}</span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {new Date(v.changedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {v.changedBy ? `by ${v.changedBy.slice(0, 8)}…` : 'system'}
                    </div>
                  </div>
                ))}
              </div>

              {currentClient && (
                <div className="mt-5 pt-4 border-t border-white/[0.06]">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Client</p>
                  <p className="text-sm font-medium text-zinc-200 truncate">{currentClient.name}</p>
                  {currentClient.industry && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">{currentClient.industry}</p>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={motionInstant}
            className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm flex items-center gap-2 ${
              toast.kind === 'success'
                ? 'bg-[color:var(--color-success-subtle)] border-[color:var(--color-success)]/30 text-[color:var(--color-success)]'
                : 'bg-[color:var(--color-danger-subtle)] border-[color:var(--color-danger)]/30 text-[color:var(--color-danger)]'
            }`}
          >
            {toast.kind === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

interface ColorSwatchFieldProps {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  helper?: string;
  error?: string | null;
}
function ColorSwatchField({ id, label, value, onChange, readOnly, helper, error }: ColorSwatchFieldProps) {
  const showSwatch = isValidHex(value) && value.length > 0;
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="w-9 h-9 rounded-lg border border-white/[0.08] shrink-0"
          style={{
            backgroundColor: showSwatch ? value : 'transparent',
            backgroundImage: showSwatch
              ? 'none'
              : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 4px, transparent 4px 8px)',
          }}
        />
        <input
          id={id}
          type="text"
          value={value}
          onChange={onChange ? e => onChange(e.target.value) : undefined}
          readOnly={readOnly}
          placeholder="#F59E0B"
          className={`flex-1 rounded-lg bg-white/[0.04] border px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none transition-colors font-mono ${
            error
              ? 'border-[color:var(--color-danger)]/40 focus:border-[color:var(--color-danger)]/60'
              : 'border-white/[0.08] focus:border-[color:var(--color-accent)]/50'
          } ${readOnly ? 'opacity-70 cursor-not-allowed' : ''}`}
        />
      </div>
      {helper && !error && <p className="mt-1 text-[10px] text-zinc-600">{helper}</p>}
      {error && <p className="mt-1 text-[10px] text-[color:var(--color-danger)]">{error}</p>}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}
function TextField({ id, label, value, placeholder, onChange }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors"
      />
    </div>
  );
}

interface SampleImageRowProps {
  index: number;
  image: BrandKitSampleImage;
  onChange: (patch: Partial<BrandKitSampleImage>) => void;
}
function SampleImageRow({ index, image, onChange }: SampleImageRowProps) {
  const hasUrl = (image.url || '').trim().length > 0;
  return (
    <motion.div
      layout
      transition={motionUI}
      className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]"
    >
      <div className="w-16 h-16 rounded-lg bg-zinc-900 border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0">
        {hasUrl ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={image.url}
            alt={image.label || `Anchor ${index + 1}`}
            className="w-full h-full object-cover"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <ImageIcon className="w-5 h-5 text-zinc-700" />
        )}
      </div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2">
        <input
          type="url"
          value={image.url}
          onChange={e => onChange({ url: e.target.value })}
          placeholder={`Image URL #${index + 1} (CDN — no base64)`}
          className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors"
        />
        <input
          type="text"
          value={image.label || ''}
          onChange={e => onChange({ label: e.target.value })}
          placeholder="Label (optional)"
          className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[color:var(--color-accent)]/50 focus:outline-none transition-colors"
        />
      </div>
      <label className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
        image.primary
          ? 'bg-[color:var(--color-accent-subtle)] text-[color:var(--color-accent)] border border-[color:var(--color-accent)]/30'
          : 'bg-white/[0.03] text-zinc-500 hover:text-zinc-300 border border-white/[0.06]'
      }`}>
        <input
          type="checkbox"
          checked={!!image.primary}
          onChange={e => onChange({ primary: e.target.checked })}
          className="sr-only"
        />
        <Star className={`w-3.5 h-3.5 ${image.primary ? 'fill-[color:var(--color-accent)] text-[color:var(--color-accent)]' : ''}`} />
        Primary
      </label>
    </motion.div>
  );
}

// ── Brand Identity Showcase ──────────────────────────────────────────
// High-end hero card that renders the actual saved brand kit as a live
// preview: color palette, typography specimen, voice quote, anchor images.
// Editing the form below updates this preview immediately (form state is
// the source of truth — not a separate fetch).
interface ShowcaseProps {
  clientName: string;
  primary: string;
  secondary: string;
  accent: string;
  fontPrimary: string;
  fontSecondary: string;
  voiceSample: string;
  sampleImages: BrandKitSampleImage[];
  version: number;
}

function BrandIdentityShowcase({
  clientName, primary, secondary, accent,
  fontPrimary, fontSecondary, voiceSample, sampleImages, version,
}: ShowcaseProps) {
  const palette = [
    { name: 'Primary', value: primary, locked: true },
    { name: 'Secondary', value: secondary, locked: false },
    { name: 'Accent', value: accent, locked: false },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionBase}
      aria-labelledby="brand-showcase-title"
      className="relative mb-6 overflow-hidden rounded-2xl border"
      style={{
        background: `linear-gradient(135deg, ${primary}14 0%, ${accent}0a 60%, transparent 100%), var(--color-bg-elevated)`,
        borderColor: 'var(--color-border)',
        boxShadow: `0 18px 50px -20px ${primary}30, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {/* Soft gradient bloom in top-right corner */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full blur-3xl opacity-40"
        style={{ background: `radial-gradient(circle, ${accent}80 0%, transparent 70%)` }}
      />

      <div className="relative p-6 sm:p-8">
        {/* Top row: title + version chip */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-fg-subtle)' }}>
              Brand Identity
            </p>
            <h2
              id="brand-showcase-title"
              className="mt-1 font-display text-2xl sm:text-3xl font-bold leading-tight truncate"
              style={{ color: 'var(--color-fg)' }}
            >
              {clientName}
            </h2>
          </div>
          <span
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              background: `${accent}1a`,
              borderColor: `${accent}40`,
              color: accent,
            }}
          >
            <Star className="h-3 w-3" aria-hidden="true" /> v{version}
          </span>
        </div>

        {/* Showcase grid */}
        <div className="mt-7 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
          {/* Left: palette + typography */}
          <div className="space-y-6">
            {/* Palette row */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-fg-subtle)' }}>
                Palette
              </p>
              <div className="grid grid-cols-3 gap-3">
                {palette.map((c) => (
                  <div
                    key={c.name}
                    className="group relative rounded-xl overflow-hidden border transition-transform hover:-translate-y-0.5"
                    style={{ borderColor: 'var(--color-border-subtle)' }}
                  >
                    <div
                      className="h-20 w-full"
                      style={{ background: c.value || '#1c1c1f' }}
                      aria-label={`${c.name} color swatch ${c.value}`}
                    />
                    <div className="px-3 py-2" style={{ background: 'var(--color-surface)' }}>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--color-fg)' }}>{c.name}</p>
                        {c.locked && <ShieldAlert className="h-3 w-3" style={{ color: 'var(--color-fg-subtle)' }} aria-label="Locked from Client" />}
                      </div>
                      <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--color-fg-subtle)' }}>
                        {c.value || '—'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Typography specimen */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-fg-subtle)' }}>
                Typography
              </p>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-surface)' }}>
                <p
                  className="text-3xl leading-none truncate"
                  style={{ fontFamily: fontPrimary, color: 'var(--color-fg)' }}
                >
                  Aa Bb Cc 123
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                  Primary · {fontPrimary}
                </p>
                <div className="my-3 h-px" style={{ background: 'var(--color-border-subtle)' }} />
                <p
                  className="text-xl italic leading-tight truncate"
                  style={{ fontFamily: fontSecondary, color: 'var(--color-fg-muted)' }}
                >
                  The brand voice speaks here.
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                  Secondary · {fontSecondary}
                </p>
              </div>
            </div>
          </div>

          {/* Right: voice quote + image strip */}
          <div className="space-y-6">
            {/* Voice quote card */}
            <div
              className="rounded-xl border p-5 relative"
              style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-surface)' }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-fg-subtle)' }}>
                Voice
              </p>
              <div
                className="absolute left-5 top-12 text-6xl font-display leading-none select-none"
                style={{ color: `${accent}22` }}
                aria-hidden="true"
              >“</div>
              <blockquote
                className="relative text-sm leading-relaxed pl-7 min-h-[3.5em] line-clamp-4"
                style={{ color: 'var(--color-fg)' }}
              >
                {voiceSample || (
                  <span style={{ color: 'var(--color-fg-subtle)' }}>
                    Add a voice sample below to see how the brand speaks.
                  </span>
                )}
              </blockquote>
            </div>

            {/* Anchor images strip */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-fg-subtle)' }}>
                Anchor Imagery
              </p>
              {sampleImages.length > 0 ? (
                <div className="grid grid-cols-5 gap-2">
                  {sampleImages.map((img, i) => (
                    <div
                      key={i}
                      className="relative aspect-square rounded-lg overflow-hidden border transition-transform hover:scale-[1.04]"
                      style={{ borderColor: img.primary ? accent : 'var(--color-border-subtle)' }}
                    >
                      <img
                        src={img.url}
                        alt={img.label || `Anchor image ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2'; }}
                      />
                      {img.primary && (
                        <div
                          className="absolute top-1 right-1 rounded-full p-0.5"
                          style={{ background: accent }}
                          aria-label="Primary anchor image"
                        >
                          <Star className="h-2.5 w-2.5" style={{ color: 'var(--color-fg-on-accent)' }} />
                        </div>
                      )}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, 5 - sampleImages.length) }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="aspect-square rounded-lg border-dashed border-2 flex items-center justify-center"
                      style={{ borderColor: 'var(--color-border-subtle)' }}
                      aria-hidden="true"
                    >
                      <ImageIcon className="h-4 w-4" style={{ color: 'var(--color-fg-subtle)', opacity: 0.4 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="rounded-xl border border-dashed p-5 text-center text-xs"
                  style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}
                >
                  Add anchor images below to preview them here.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
