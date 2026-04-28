export {};

declare global {
  interface Window {
    electron?: {
      platform?: string;
      isDesktop?: boolean;
      apiBaseUrl?: string | null;
      getServerPort?: () => Promise<number | null>;
      minimize?: () => void;
      maximize?: () => void;
      close?: () => void;
    };
  }
}
