/**
 * Button — primary/secondary/ghost/danger × sm/md/lg variants via cva.
 * Token-driven. Replaces the ad-hoc `<button className="bg-amber-500 …">`
 * scattered across pages.
 *
 * Usage:
 *   <Button variant="primary" size="md" onClick={...}>Save</Button>
 *   <Button variant="ghost" size="sm" leftIcon={<Plus size={14}/>}>Add</Button>
 *   <Button variant="danger" loading>Delete</Button>
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors cursor-pointer outline-none focus-visible:ring-2 disabled:opacity-40 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'bg-[color:var(--color-accent)] text-[color:var(--color-fg-on-accent)] hover:bg-[color:var(--color-accent-hover)] active:bg-[color:var(--color-accent-pressed)] focus-visible:ring-[color:var(--color-accent)]',
        secondary:
          'bg-[color:var(--color-surface-hover)] text-[color:var(--color-fg)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-active)] focus-visible:ring-[color:var(--color-border-strong)]',
        ghost:
          'bg-transparent text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--color-fg)] focus-visible:ring-[color:var(--color-border-strong)]',
        danger:
          'bg-[color:var(--color-danger)] text-[color:var(--color-fg-on-accent)] hover:bg-[color:var(--color-danger-strong)] focus-visible:ring-[color:var(--color-danger)]',
        link:
          'bg-transparent text-[color:var(--color-accent)] hover:underline px-0 h-auto',
      },
      size: {
        sm: 'text-[12px] px-3 py-1.5 h-8',
        md: 'text-[13px] px-4 py-2 h-9',
        lg: 'text-[14px] px-5 py-2.5 h-10',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  }
);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant, size, block, leftIcon, rightIcon, loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
