/**
 * Workspace.SettingsDetail — section panels for the Settings surface.
 *
 * Slug → panel:
 *   "profile"  → current user (authApi.me)
 *   "members"  → org membership list (orgsApi.list)
 *   "billing"  → Stripe portal trigger (billingApi.portal)
 *   "api-keys" → deep-link to /profile (the API keys editor lives there)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, User as UserIcon, Users, CreditCard, KeyRound } from 'lucide-react';
import { authApi, orgsApi, billingApi, type MeRecord, type OrgMembership } from '../lib/backend-api';
import { Badge, Button, EmptyState, Separator } from '../components/ui';
import { toast } from 'sonner';

export default function SettingsDetail({ pieceId: slug }: { pieceId: string }) {
  const navigate = useNavigate();

  if (slug === 'profile')   return <ProfilePanel onOpen={() => navigate('/profile')} />;
  if (slug === 'members')   return <MembersPanel onOpen={() => navigate('/members')} />;
  if (slug === 'billing')   return <BillingPanel onOpen={() => navigate('/billing')} />;
  if (slug === 'api-keys')  return <ApiKeysPanel onOpen={() => navigate('/profile')} />;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={UserIcon}
        title="Pick a section"
        description="Profile, Members, Billing, or API Keys."
        compact
      />
    </div>
  );
}

const PanelHeader = ({ title, subtitle, onOpen }: { title: string; subtitle: string; onOpen: () => void }) => (
  <>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
          {title}
        </h1>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>{subtitle}</p>
      </div>
      <Button variant="ghost" size="sm" rightIcon={<ExternalLink size={12} />} onClick={onOpen}>
        Open settings
      </Button>
    </div>
    <Separator />
  </>
);

const Pair = ({ k, v }: { k: string; v: string }) => (
  <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-[13px]">
    <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>{k}</dt>
    <dd style={{ color: 'var(--color-fg)' }}>{v}</dd>
  </div>
);

function ProfilePanel({ onOpen }: { onOpen: () => void }) {
  const [me, setMe] = useState<MeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    authApi.me().then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  if (!me) return <Missing icon={UserIcon} title="Profile unavailable" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <PanelHeader title="Profile" subtitle="Your account in this workspace." onOpen={onOpen} />
      <dl>
        <Pair k="Name" v={me.name} />
        <Pair k="Email" v={me.email} />
        <Pair k="Role" v={me.role} />
        <Pair k="Member since" v={new Date(me.createdAt).toLocaleDateString()} />
      </dl>
    </div>
  );
}

function MembersPanel({ onOpen }: { onOpen: () => void }) {
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    orgsApi.list().then(setOrgs).catch(() => setOrgs(null)).finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  if (!orgs || orgs.length === 0) return <Missing icon={Users} title="No org memberships" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <PanelHeader title="Members" subtitle="Organizations you belong to and your role in each." onOpen={onOpen} />
      <ul className="space-y-2">
        {orgs.map((m) => (
          <li
            key={m.orgId}
            className="flex items-center justify-between rounded-lg border p-3"
            style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
          >
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-fg)' }}>{m.org.name}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>{m.org.slug} · {m.org.plan}</p>
            </div>
            <Badge subtle tone={m.role === 'OWNER' ? 'accent' : 'info'}>{m.role}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BillingPanel({ onOpen }: { onOpen: () => void }) {
  const [opening, setOpening] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <PanelHeader title="Billing" subtitle="Plan, invoices, and payment method live in the Stripe portal." onOpen={onOpen} />
      <Button
        variant="primary"
        size="md"
        leftIcon={<CreditCard size={14} />}
        loading={opening}
        onClick={async () => {
          setOpening(true);
          try {
            const { url } = await billingApi.portal();
            window.location.href = url;
          } catch (e: any) {
            toast.error(e?.message || 'Could not open billing portal');
          } finally {
            setOpening(false);
          }
        }}
      >
        Open Stripe portal
      </Button>
    </div>
  );
}

function ApiKeysPanel({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <PanelHeader title="API keys" subtitle="Per-workspace keys for external integrations." onOpen={onOpen} />
      <p className="text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
        API key creation and revocation live in the legacy Profile page. Tap the button above to manage.
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
    </div>
  );
}

function Missing({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState icon={Icon} title={title} description="Try again from the legacy settings page." compact />
    </div>
  );
}

// Suppress unused-import lint when the icon set is exhaustive — tree-shaken in build.
export { KeyRound };
