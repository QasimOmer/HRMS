'use client';

import type { Module, Permission, Role } from '@hrms/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api } from './api';

export interface Me {
  user: {
    id: string;
    email: string;
    roles: Role[];
    permissions: Permission[];
    ledTeamIds: string[];
    canPost: boolean;
    mustChangePassword: boolean;
    guidelinesAccepted: boolean;
  };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string;
    avatarFileId: string | null;
    departmentId: string;
    departmentName: string;
    onboardingCompletedAt: string | null;
    medicalEligible: boolean;
  } | null;
  onboardingRequired: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    logoFileId: string | null;
    /** Login emails of this company end with @emailDomain. */
    emailDomain: string | null;
    /** Feature modules in the company's plan. */
    modules: string[];
    maxEmployees: number | null;
    settings: { directoryShowJoinDate: boolean; communityPostingMode: string; communityEngagementEnabled: boolean; medicalAnnualLimit: number };
    /** Subscription: UNPAID locks the workspace to Billing, DUE shows a reminder. */
    billingStatus: 'PAID' | 'DUE' | 'UNPAID';
    billingCycle: 'MONTHLY' | 'ANNUAL';
    paidUntil: string | null;
    /** The public read-only demo company. */
    isDemo: boolean;
  };
}

interface AuthCtx {
  me: Me | undefined;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  hasRole: (...roles: Role[]) => boolean;
  isTeamLead: boolean;
  /** Is this module part of the company's plan? */
  hasModule: (m: Module) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // /auth/session restores the session (refreshing an expired access token server-side) in one call.
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const r = await api.get<({ authenticated: true } & Me) | { authenticated: false }>('/auth/session');
      if (!r.authenticated) {
        const here = window.location.pathname + window.location.search;
        window.location.replace(`/login?next=${encodeURIComponent(here)}`);
        return new Promise<Me>(() => {}); // keep the skeleton until the browser navigates
      }
      return r as Me;
    },
    staleTime: 60_000,
    retry: false,
  });
  const perms = useMemo(() => new Set(data?.user.permissions ?? []), [data]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/login';
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      me: data,
      loading: isLoading,
      can: (...p) => p.some((x) => perms.has(x)),
      hasRole: (...r) => r.some((x) => data?.user.roles.includes(x) ?? false),
      isTeamLead: (data?.user.ledTeamIds.length ?? 0) > 0,
      hasModule: (m) => data?.tenant.modules.includes(m) ?? false,
      refresh: refetch,
      logout,
    }),
    [data, isLoading, perms, refetch, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** D3: may this person claim medical expenses? (HR ticked them, and the company has a yearly limit.) */
export function useMedicalEligible(): boolean {
  const { me } = useAuth();
  return !!me?.employee?.medicalEligible && (me?.tenant.settings.medicalAnnualLimit ?? 0) > 0;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
