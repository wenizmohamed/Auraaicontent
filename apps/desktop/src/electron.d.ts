export {};

declare global {
  interface Window {
    electron?: {
      platform?: string;
      isDesktop?: boolean;
      apiBaseUrl?: string;
      minimize?: () => void;
      maximize?: () => void;
      close?: () => void;
    };
  }
}
