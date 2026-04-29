/**
 * @tanstack/react-query — central QueryClient. Pages opt-in incrementally
 * by calling useQuery / useMutation. Existing imperative fetch sites in
 * the *Api modules keep working unchanged; this is additive.
 *
 * staleTime: 30s for most lists keeps the UI snappy on tab-switch without
 * burning the API. retry: 1 + exponential backoff matches the existing
 * fetch ladder behavior in lib/backend-api.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
