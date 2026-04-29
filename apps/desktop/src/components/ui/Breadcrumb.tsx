/**
 * Breadcrumb — sibling-dropdown nav (Notion pattern). Each segment is a
 * link to the parent route AND a Radix DropdownMenu trigger that lists
 * sibling routes for fast lateral navigation.
 *
 * Usage:
 *   <Breadcrumb>
 *     <Breadcrumb.Item href="/clients" siblings={[
 *       { label: 'Brief', href: '/brief' },
 *       { label: 'Calendar', href: '/calendar' },
 *     ]}>Clients</Breadcrumb.Item>
 *     <Breadcrumb.Item>Al Fardan Exchange</Breadcrumb.Item>
 *   </Breadcrumb>
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface Sibling {
  label: string;
  href: string;
}

interface ItemProps {
  /** Link target. Omit on the leaf segment to render plain text. */
  href?: string;
  /** Sibling routes — when present a dropdown caret + popover appear. */
  siblings?: Sibling[];
  children: ReactNode;
}

function BreadcrumbItem({ href, siblings, children }: ItemProps) {
  const labelCls = 'text-[12px] font-medium hover:text-[color:var(--color-fg)] transition-colors';
  const Body = href ? (
    <Link to={href} className={labelCls} style={{ color: 'var(--color-fg-muted)' }}>{children}</Link>
  ) : (
    <span className={labelCls} style={{ color: 'var(--color-fg)' }}>{children}</span>
  );

  if (!siblings || siblings.length === 0) return Body;

  return (
    <span className="inline-flex items-center gap-0.5">
      {Body}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="rounded p-0.5 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
          aria-label="Sibling routes"
        >
          <ChevronDown size={11} style={{ color: 'var(--color-fg-subtle)' }} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            align="start"
            className="z-popover min-w-[180px] rounded-lg border p-1 shadow-[0_8px_18px_rgba(0,0,0,0.25)]"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-fg)',
            }}
          >
            {siblings.map((s) => (
              <DropdownMenu.Item
                key={s.href}
                asChild
                className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] outline-none transition-colors data-[highlighted]:bg-[color:var(--color-surface-hover)]"
              >
                <Link to={s.href}>{s.label}</Link>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}

export function Breadcrumb({ children }: { children: ReactNode }) {
  // Insert chevron separators between children at runtime.
  const items = Array.isArray(children) ? children : [children];
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px]">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && (
            <ChevronRight size={11} style={{ color: 'var(--color-fg-subtle)' }} aria-hidden />
          )}
          {item}
        </span>
      ))}
    </nav>
  );
}

Breadcrumb.Item = BreadcrumbItem;
