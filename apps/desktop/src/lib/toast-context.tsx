/**
 * Toast API — preserves the historical { toast, success, error, info }
 * shape so existing call sites in Gallery / Knowledge / ContentPieces /
 * VisualReferences keep working unchanged. The actual rendering is
 * delegated to sonner's <Toaster /> mounted at the App root, which gives
 * us stacking, swipe-to-dismiss, theme awareness, and a11y for free.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

function fire(message: string, type: ToastType) {
  if (type === 'success') sonnerToast.success(message);
  else if (type === 'error') sonnerToast.error(message);
  else sonnerToast(message);
}

const ToastContext = createContext<ToastContextType>({
  toast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ToastContextType>(() => ({
    toast: (msg, type = 'info') => fire(msg, type),
    success: (msg) => fire(msg, 'success'),
    error: (msg) => fire(msg, 'error'),
    info: (msg) => fire(msg, 'info'),
  }), []);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
