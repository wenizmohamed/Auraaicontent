import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import {
  LayoutDashboard, Calendar, FileText, Layers, Building2, Wand2,
  Image as ImageIcon, Video, Search, Palette, FolderOpen, Sparkles,
  UserCircle, CreditCard, ShieldCheck, Brain, Settings,
  CalendarDays, Lightbulb, Compass, Sun, Moon
} from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { t, getLocale, setLocale } from '../i18n';

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  perform: () => void;
  keywords?: string[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [search, setSearch] = useState('');

  const items = useMemo<Item[]>(() => {
    const go = (path: string) => () => { navigate(path); onOpenChange(false); };
    return [
      // ── Navigation ───────────────────────────────────────────────────
      { id: 'nav-dashboard',  group: 'Workspace',  label: 'Dashboard',         hint: 'Overview + insights',          icon: LayoutDashboard, perform: go('/'),                  keywords: ['home','insights'] },
      { id: 'nav-calendar',   group: 'Workspace',  label: 'Calendar',          hint: 'Plan + schedule posts',        icon: Calendar,        perform: go('/calendar'),          keywords: ['month','schedule','plan'] },
      { id: 'nav-clients',    group: 'Workspace',  label: 'Clients',           hint: 'Brand list + management',      icon: Building2,       perform: go('/clients'),           keywords: ['brands','accounts'] },
      { id: 'nav-brief',      group: 'Workspace',  label: 'Brief',             hint: 'Strategy + brand input',       icon: FileText,        perform: go('/brief'),             keywords: ['strategy','positioning'] },
      { id: 'nav-knowledge',  group: 'Workspace',  label: 'Knowledge',         hint: 'Brand knowledge base',         icon: Brain,           perform: go('/knowledge'),         keywords: ['rag','docs','context'] },
      { id: 'nav-review',     group: 'Workspace',  label: 'Content Review',    hint: 'Approve + reject posts',       icon: Layers,          perform: go('/content-review'),    keywords: ['approve','queue','moderate'] },
      { id: 'nav-pieces',     group: 'Workspace',  label: 'Content Pieces',    hint: 'Drafted content library',      icon: FolderOpen,      perform: go('/pieces'),            keywords: ['drafts','library'] },

      // ── Studio / creative ───────────────────────────────────────────
      { id: 'nav-creative',   group: 'Studio',     label: 'Creative Tools',    hint: 'Image + video generation',     icon: Wand2,           perform: go('/creative'),          keywords: ['ai','generate','art'] },
      { id: 'nav-image-gen',  group: 'Studio',     label: 'Text → Image',      hint: 'Generate visuals from prompt', icon: ImageIcon,       perform: go('/image-gen'),         keywords: ['t2i','generate'] },
      { id: 'nav-image-edit', group: 'Studio',     label: 'Image Editor',      hint: 'Edit + retouch existing',      icon: Palette,         perform: go('/image-edit'),        keywords: ['retouch','edit'] },
      { id: 'nav-t2v',        group: 'Studio',     label: 'Text → Video',      hint: 'Generate video clips',         icon: Video,           perform: go('/text-to-video'),     keywords: ['t2v','grok','veo'] },
      { id: 'nav-i2v',        group: 'Studio',     label: 'Image → Video',     hint: 'Animate stills',               icon: Video,           perform: go('/image-to-video'),    keywords: ['i2v','animate'] },
      { id: 'nav-ai-design',  group: 'Studio',     label: 'AI Design',         hint: 'Generative layouts',           icon: Lightbulb,       perform: go('/ai-design'),         keywords: ['layouts'] },
      { id: 'nav-textures',   group: 'Studio',     label: 'Textures',          hint: 'Background textures + grain',  icon: Palette,         perform: go('/textures') },
      { id: 'nav-references', group: 'Studio',     label: 'Visual References', hint: 'Inspiration board',            icon: ImageIcon,       perform: go('/references'),        keywords: ['mood','inspiration'] },
      { id: 'nav-gallery',    group: 'Studio',     label: 'Gallery',           hint: 'All generated visuals',        icon: ImageIcon,       perform: go('/gallery') },
      { id: 'nav-video',      group: 'Studio',     label: 'Video Analysis',    hint: 'Analyze + caption clips',      icon: Video,           perform: go('/video') },
      { id: 'nav-studio',     group: 'Studio',     label: 'Studio',            hint: 'Studio workspace',             icon: Sparkles,        perform: go('/studio') },

      // ── Insights / research ─────────────────────────────────────────
      { id: 'nav-research',   group: 'Insights',   label: 'Research',          hint: 'Web + market research',        icon: Search,          perform: go('/research') },
      { id: 'nav-topics',     group: 'Insights',   label: 'Topic Desk',        hint: 'Trending topics + ideas',      icon: Compass,         perform: go('/topics') },
      { id: 'nav-admin',      group: 'Insights',   label: 'Admin',             hint: 'Org + usage metrics',          icon: ShieldCheck,     perform: go('/admin') },

      // ── Settings ────────────────────────────────────────────────────
      { id: 'nav-profile',    group: 'Settings',   label: 'Profile',           hint: 'Personal account',             icon: UserCircle,      perform: go('/profile') },
      { id: 'nav-members',    group: 'Settings',   label: 'Team',              hint: 'Invite + manage members',      icon: UserCircle,      perform: go('/settings/members'),  keywords: ['members','invite','team'] },
      { id: 'nav-billing',    group: 'Settings',   label: 'Billing',           hint: 'Plan + invoices',              icon: CreditCard,      perform: go('/settings/billing') },
      { id: 'nav-onboarding', group: 'Settings',   label: 'Onboarding',        hint: 'First-run wizard',             icon: CalendarDays,    perform: go('/onboarding') },

      // ── Quick actions ───────────────────────────────────────────────
      {
        id: 'act-theme-dark', group: 'Theme', label: 'Theme: Dark',
        hint: 'Switch to dark mode', icon: Moon,
        perform: () => { setTheme('dark'); onOpenChange(false); }, keywords: ['night']
      },
      {
        id: 'act-theme-light', group: 'Theme', label: 'Theme: Light',
        hint: 'Switch to light mode', icon: Sun,
        perform: () => { setTheme('light'); onOpenChange(false); }, keywords: ['day']
      },
      {
        id: 'act-theme-studio', group: 'Theme', label: 'Theme: Studio',
        hint: 'High-contrast monochrome', icon: Sparkles,
        perform: () => { setTheme('studio'); onOpenChange(false); }, keywords: ['mono','designer']
      },
      {
        id: 'act-locale-en', group: 'Locale', label: 'Locale: English',
        hint: 'Switch UI to English', icon: Settings,
        perform: () => { if (getLocale() !== 'en') { setLocale('en'); window.location.reload(); } onOpenChange(false); }
      },
      {
        id: 'act-locale-ar', group: 'Locale', label: 'Locale: العربية',
        hint: 'Switch UI to Arabic (RTL)', icon: Settings,
        perform: () => { if (getLocale() !== 'ar') { setLocale('ar'); window.location.reload(); } onOpenChange(false); }
      },
    ];
    // theme is intentionally outside deps — items only depend on closures, not values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, setTheme]);

  // Reset query when palette closes
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-modal-backdrop bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <Dialog.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[18%] z-modal w-[640px] max-w-[92vw] -translate-x-1/2 outline-none"
        >
          <Dialog.Title className="sr-only">Search or run a command</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to search across pages and actions. Use arrow keys to navigate, enter to select, escape to close.
          </Dialog.Description>

          <Command
            label="Command palette"
            className="flex h-full flex-col overflow-hidden rounded-2xl border shadow-[0_28px_60px_rgba(0,0,0,0.45)]"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-fg)',
            }}
            shouldFilter={true}
          >
            <div
              className="flex items-center gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <Search size={16} style={{ color: 'var(--color-fg-subtle)' }} />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={t('cmdk.placeholder') || 'Search or jump to…'}
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[color:var(--color-fg-subtle)]"
                style={{ color: 'var(--color-fg)' }}
                autoFocus
              />
              <kbd
                className="hidden sm:inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-fg-subtle)',
                  background: 'var(--color-surface)'
                }}
              >ESC</kbd>
            </div>

            <Command.List
              className="max-h-[60vh] overflow-y-auto px-2 py-2"
              style={{ scrollbarGutter: 'stable' }}
            >
              <Command.Empty
                className="py-10 text-center text-sm"
                style={{ color: 'var(--color-fg-subtle)' }}
              >
                No matches. Try “calendar”, “invite”, or “theme”.
              </Command.Empty>

              {Array.from(new Set(items.map(i => i.group))).map(group => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em]"
                >
                  {items.filter(i => i.group === group).map(item => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.hint ?? ''} ${(item.keywords ?? []).join(' ')}`}
                        onSelect={() => item.perform()}
                        className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-[color:var(--color-surface-hover)] data-[selected=true]:bg-[color:var(--color-surface-hover)]"
                        style={{ color: 'var(--color-fg)' }}
                      >
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-md"
                          style={{ background: 'var(--color-surface)', color: 'var(--color-fg-muted)' }}
                        >
                          <Icon size={14} />
                        </span>
                        <span className="flex-1 truncate font-medium">{item.label}</span>
                        {item.hint && (
                          <span
                            className="hidden sm:inline truncate text-xs"
                            style={{ color: 'var(--color-fg-subtle)' }}
                          >{item.hint}</span>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>

            <div
              className="flex items-center justify-between border-t px-4 py-2 text-[10px]"
              style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}
            >
              <span className="flex items-center gap-3">
                <span>↑↓ navigate</span>
                <span>↵ open</span>
              </span>
              <span>{items.length} actions · theme: {theme}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ⌘K registration moved to App.tsx via useShortcut(...) so it appears in
// the "?" cheat sheet. The palette no longer owns its own keybinding.
