import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { clientsApi, authApi, setAuthToken, setRefreshToken, clearAuthToken, onForcedLogout, isServerAvailable, type BackendClient } from './backend-api';

interface ClientContextType {
  clients: BackendClient[];
  selectedClientId: string | null;
  currentClient: BackendClient | null;
  loading: boolean;
  authenticated: boolean;
  authError: string | null;
  serverOnline: boolean;
  setSelectedClientId: (id: string) => void;
  fetchClients: () => Promise<void>;
  createClient: (data: { name: string; industry?: string; website?: string }) => Promise<BackendClient>;
  updateClient: (id: string, data: Partial<BackendClient>) => Promise<BackendClient>;
  deleteClient: (id: string) => Promise<void>;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, password: string, name: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<BackendClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(localStorage.getItem('radix_selected_client'));
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(false);

  // Fetch clients and reconcile the persisted selection with the live list
  const fetchAndReconcile = useCallback(async () => {
    try {
      const data = await clientsApi.list();
      setClients(data);

      // Reconcile persisted selection:
      //   - If selectedClientId is missing OR refers to a deleted client, fall back to first available.
      //   - Fixes "Save brief failed: Internal Server Error" from a stale id pointing to a deleted client.
      const persisted = localStorage.getItem('radix_selected_client');
      const stillExists = persisted && data.some(c => c.id === persisted);
      if (!stillExists) {
        if (persisted) {
          console.warn(`[client-context] Persisted client ${persisted} no longer exists. Falling back`);
        }
        if (data.length > 0) {
          const first = data[0].id;
          setSelectedClientId(first);
          localStorage.setItem('radix_selected_client', first);
        } else {
          setSelectedClientId(null);
          localStorage.removeItem('radix_selected_client');
        }
      } else {
        setSelectedClientId(persisted);
      }
    } catch (err: any) {
      setAuthError(`Failed to load clients: ${err.message}`);
    }
  }, []);

  // Bootstrap — only checks for an existing valid token. Never auto-logs in with baked credentials.
  const bootstrap = useCallback(async () => {
    setLoading(true);
    setAuthError(null);

    const online = await isServerAvailable();
    setServerOnline(online);
    if (!online) {
      setAuthError('Backend server is not running');
      setLoading(false);
      return;
    }

    // Try existing token — if valid, user is signed in; if not, show login screen.
    const existingToken = localStorage.getItem('radix_auth_token');
    if (existingToken) {
      setAuthToken(existingToken);
      try {
        await authApi.me();
        setAuthenticated(true);
        await fetchAndReconcile();
      } catch {
        clearAuthToken();
        setAuthenticated(false);
      }
    } else {
      setAuthenticated(false);
    }

    setLoading(false);
  }, [fetchAndReconcile]);

  useEffect(() => { bootstrap(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auth actions ───────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const { token, refreshToken } = await authApi.login(email, password, rememberMe);
    setAuthToken(token);
    setRefreshToken(refreshToken ?? null);
    // Remember-me preference is surfaced to the UI for display. The access
    // token is short-lived (1h / 7d with rememberMe); backend-api silently
    // rotates via /api/auth/refresh using the 30-day refresh token.
    try { localStorage.setItem('radix_remember_me', rememberMe ? '1' : '0'); } catch {}
    setAuthenticated(true);
    setAuthError(null);
    await fetchAndReconcile();
  }, [fetchAndReconcile]);

  const register = useCallback(async (email: string, password: string, name: string, rememberMe = false) => {
    const { token, refreshToken } = await authApi.register(email, password, name, rememberMe);
    setAuthToken(token);
    setRefreshToken(refreshToken ?? null);
    try { localStorage.setItem('radix_remember_me', rememberMe ? '1' : '0'); } catch {}
    setAuthenticated(true);
    setAuthError(null);
    await fetchAndReconcile();
  }, [fetchAndReconcile]);

  const logout = useCallback(() => {
    // Fire-and-forget revoke the refresh token server-side before wiping local state.
    void authApi.logout();
    clearAuthToken();
    setAuthenticated(false);
    setClients([]);
    setSelectedClientId(null);
    localStorage.removeItem('radix_selected_client');
  }, []);

  // When backend-api detects refresh expiry or reuse-revocation, it fires
  // onForcedLogout -> we flip the React state to show the login screen.
  useEffect(() => {
    const unsubscribe = onForcedLogout((reason) => {
      console.warn('[auth] forced logout:', reason);
      setAuthenticated(false);
      setClients([]);
      setSelectedClientId(null);
      localStorage.removeItem('radix_selected_client');
      if (reason === 'refresh-reuse') {
        setAuthError('Session revoked for security. Please log in again.');
      } else if (reason === 'refresh-expired') {
        setAuthError('Session expired. Please log in again.');
      }
    });
    return () => { unsubscribe(); };
  }, []);

  // ─── Client actions ─────────────────────────────────────────────

  const fetchClients = useCallback(async () => {
    try {
      const data = await clientsApi.list();
      setClients(data);
    } catch {}
  }, []);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    localStorage.setItem('radix_selected_client', id);
  }, []);

  const createClient = useCallback(async (data: { name: string; industry?: string; website?: string }) => {
    const client = await clientsApi.create(data);
    setClients(prev => [client, ...prev]);
    return client;
  }, []);

  const updateClient = useCallback(async (id: string, data: Partial<BackendClient>) => {
    // Strip read-only fields the backend rejects
    const { id: _id, slug: _slug, status: _status, brief: _brief, ...patch } = data as any;
    const updated = await clientsApi.update(id, patch);
    setClients(prev => prev.map(c => (c.id === id ? { ...c, ...updated } : c)));
    return updated;
  }, []);

  const deleteClient = useCallback(async (id: string) => {
    await clientsApi.delete(id);
    setClients(prev => {
      const next = prev.filter(c => c.id !== id);
      // If the deleted client was selected, switch to the next one (or clear)
      if (selectedClientId === id) {
        const newSelected = next[0]?.id || '';
        setSelectedClientId(newSelected);
        if (newSelected) localStorage.setItem('radix_selected_client', newSelected);
        else localStorage.removeItem('radix_selected_client');
      }
      return next;
    });
  }, [selectedClientId]);

  const currentClient = clients.find(c => c.id === selectedClientId) || null;

  return (
    <ClientContext.Provider value={{
      clients, selectedClientId, currentClient, loading, authenticated, authError, serverOnline,
      setSelectedClientId: handleSelectClient, fetchClients, createClient, updateClient, deleteClient,
      login, register, logout,
    }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClients() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClients must be used within ClientProvider');
  return ctx;
}
