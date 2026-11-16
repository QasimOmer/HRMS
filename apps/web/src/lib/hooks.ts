'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api } from './api';

/** GET with caching. `path = null` disables the query. */
export function useApi<T>(path: string | null, opts: { enabled?: boolean; refetchInterval?: number; fresh?: boolean } = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api.get<T>(path!),
    enabled: path !== null && (opts.enabled ?? true),
    refetchInterval: opts.refetchInterval,
    // `fresh`: always reload when the page opens or regains focus (lists that can change outside this tab).
    ...(opts.fresh ? { staleTime: 0, refetchOnMount: 'always' as const, refetchOnWindowFocus: true } : {}),
  });
}

type Method = 'post' | 'put' | 'patch' | 'del';

/**
 * Mutation with toast feedback and cache invalidation.
 * `invalidate` takes path prefixes; every cached query whose path starts with one is refetched.
 */
export function useAction<TVars = unknown, TResult = unknown>(
  method: Method,
  path: string | ((v: TVars) => string),
  opts: { invalidate?: string[]; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult, v: TVars) => void; body?: (v: TVars) => unknown } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: async (vars) => {
      const p = typeof path === 'function' ? path(vars) : path;
      // Without a body builder, only object variables are sent as the body. An id passed just to build the
      // path (e.g. mark a notification read) must not become the body: a bare JSON string is rejected.
      const raw = opts.body ? opts.body(vars) : vars;
      const body = (raw !== null && typeof raw === 'object' ? raw : undefined) as Parameters<typeof api.post>[1];
      if (method === 'del') return api.del<TResult>(p);
      return api[method]<TResult>(p, body);
    },
    onSuccess: (r, v) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      const prefixes = opts.invalidate ?? [];
      qc.invalidateQueries({
        predicate: (q) => {
          const key = (q.queryKey as QueryKey)[0];
          return typeof key === 'string' && (prefixes.some((p) => key.startsWith(p)) || key === '/notifications/unread-count' || key === '/approvals/inbox');
        },
      });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(e.message || 'Something went wrong'),
  });
}
