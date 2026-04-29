/**
 * Image — drop-in replacement for <img> with shimmer placeholder + fade-in.
 * No backend blurhash required; uses the .skeleton CSS class as the
 * placeholder so it themes with dark / light / studio. Native lazy loading
 * + decode async keep it cheap.
 *
 * Usage:
 *   <Image src={asset.fileUrl} alt={asset.name} className="w-full h-full object-cover" />
 */
import { useState, type ImgHTMLAttributes } from 'react';

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  /** Border radius for the placeholder skeleton. Default: matches container. */
  radius?: string;
};

export function Image({ className = '', radius, onLoad, onError, alt = '', ...rest }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <span className={`relative block overflow-hidden ${className}`} style={{ borderRadius: radius }}>
      {!loaded && !errored && (
        <span
          aria-hidden
          className="absolute inset-0 skeleton"
          style={{ borderRadius: radius }}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        {...rest}
        alt={alt}
        loading={rest.loading ?? 'lazy'}
        decoding={rest.decoding ?? 'async'}
        onLoad={(e) => { setLoaded(true); onLoad?.(e); }}
        onError={(e) => { setErrored(true); onError?.(e); }}
        className="block h-full w-full object-cover"
        style={{
          opacity: loaded ? 1 : 0,
          transition: 'opacity var(--dur-base) var(--ease-out-expo)',
          ...rest.style,
        }}
      />
    </span>
  );
}
