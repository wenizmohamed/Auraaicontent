/**
 * Avatar — token-themed wrapper over @radix-ui/react-avatar.
 * Renders an image, falls back to initials with token-tinted bg.
 */
import * as RadixAvatar from '@radix-ui/react-avatar';

interface Props {
  src?: string;
  name?: string;
  size?: number;
  alt?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ src, name = '', size = 32, alt }: Props) {
  return (
    <RadixAvatar.Root
      className="inline-flex items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, background: 'var(--color-accent-subtle)' }}
    >
      {src && (
        <RadixAvatar.Image
          src={src}
          alt={alt ?? name}
          className="h-full w-full object-cover"
        />
      )}
      <RadixAvatar.Fallback
        delayMs={400}
        className="text-[11px] font-semibold leading-none"
        style={{ color: 'var(--color-accent)' }}
      >
        {initials(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
