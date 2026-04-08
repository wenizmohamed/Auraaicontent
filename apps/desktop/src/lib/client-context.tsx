import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { clientsApi, authApi, setAuthToken, isServerAvailable, type BackendClient } from './backend-api';

// Internal dev credentials — auto-login on startup
const DEV_EMAIL = 'mohamed@radixmedia.ae';
const DEV_PASSWORD = 'Radix2026';

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
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<BackendClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(localStorage.getItem('radix_selected_client'));
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(false);

  // Auto-login then fetch clients
  const bootstrap = useCallback(async () => {
    setLoading(true);
    setAuthError(null);

    const online = await isServerAvailable();
    setServerOnline(online);

    if (!online) {
      setAuthError('Backend server is not running (http://localhost:8080)');
      setLoading(false);
      return;
    }

    // Try existing token first
    const existingToken = localStorage.getItem('radix_auth_token');
    if (existingToken) {
      setAuthToken(existingToken);
      try {
        await authApi.me();
        setAuthenticated(true);
      } catch {
        // Token expired — re-login
        localStorage.removeItem('radix_auth_token');
      }
    }

    // Auto-login if not authenticated yet
    if (!authenticated) {
      try {
        const { token } = await authApi.login(DEV_EMAIL, DEV_PASSWORD);
        setAuthToken(token);
        setAuthenticated(true);
      } catch (err: any) {
        // Try register if login fails (first run)
        try {
          const { token } = await authApi.register(DEV_EMAIL, DEV_PASSWORD, 'Mohamed S.');
          setAuthToken(token);
          setAuthenticated(true);
        } catch (regErr: any) {
          setAuthError(`Auth failed: ${regErr.message}`);
          setLoading(false);
          return;
        }
      }
    }

    // Fetch clients from backend
    try {
      const data = await clientsApi.list();
      setClients(data);
      if (!selectedClientId && data.length > 0) {
        setSelectedClientId(data[0].id);
        localStorage.setItem('radix_selected_client', data[0].id);
      }
    } catch (err: any) {
      setAuthError(`Failed to load clients: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, []);

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

  const currentClient = clients.find(c => c.id === selectedClientId) || null;

  return (
    <ClientContext.Provider value={{
      clients, selectedClientId, currentClient, loading, authenticated, authError, serverOnline,
      setSelectedClientId: handleSelectClient, fetchClients, createClient,
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
