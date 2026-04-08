import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { clientsApi, type BackendClient, isServerAvailable } from './backend-api';
import { getClients as getLocalClients, type ClientKB } from './clients';

interface ClientContextType {
  clients: BackendClient[];
  selectedClientId: string | null;
  currentClient: BackendClient | null;
  loading: boolean;
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
  const [serverOnline, setServerOnline] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const online = await isServerAvailable();
      setServerOnline(online);

      if (online) {
        const data = await clientsApi.list();
        setClients(data);
        // Auto-select first if none selected
        if (!selectedClientId && data.length > 0) {
          setSelectedClientId(data[0].id);
          localStorage.setItem('radix_selected_client', data[0].id);
        }
      } else {
        // Fallback to local seed data
        const local = getLocalClients();
        const mapped: BackendClient[] = local.map((c: ClientKB) => ({
          id: c.id, name: c.name, slug: c.id, industry: c.industry,
          website: c.website, instagramHandle: c.socialHandles?.instagram || null,
          primaryColor: null, logoUrl: null, status: 'active',
        }));
        setClients(mapped);
        if (!selectedClientId && mapped.length > 0) {
          setSelectedClientId(mapped[0].id);
        }
      }
    } catch {
      // Fallback
      const local = getLocalClients();
      setClients(local.map((c: ClientKB) => ({
        id: c.id, name: c.name, slug: c.id, industry: c.industry,
        website: c.website, instagramHandle: null,
        primaryColor: null, logoUrl: null, status: 'active',
      })));
    } finally {
      setLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => { fetchClients(); }, []);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    localStorage.setItem('radix_selected_client', id);
  }, []);

  const createClient = useCallback(async (data: { name: string; industry?: string; website?: string }) => {
    if (serverOnline) {
      const client = await clientsApi.create(data);
      setClients(prev => [client, ...prev]);
      return client;
    }
    throw new Error('Server offline — cannot create client');
  }, [serverOnline]);

  const currentClient = clients.find(c => c.id === selectedClientId) || null;

  return (
    <ClientContext.Provider value={{
      clients, selectedClientId, currentClient, loading, serverOnline,
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
