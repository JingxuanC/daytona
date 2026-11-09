/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { useConfig } from '@/hooks/useConfig'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useAuth } from 'react-oidc-context'
import { ProviderApiClient } from './client'
import type {
  ProviderAlertState,
  ProviderAlertsResponse,
  ProviderEarningsQuery,
  ProviderEarningsResponse,
  ProviderNodeSandboxesResponse,
  ProviderNodesResponse,
  ProviderPricingResponse,
  ProviderSettlementDetail,
  ProviderSettlementQuery,
  ProviderSettlementsResponse,
  ProviderSettlementStatus,
  ProviderUsageQuery,
  ProviderUsageResponse,
  UpdateProviderPricingPayload,
} from './types'

export const providerQueryKeys = {
  all: ['provider'] as const,
  nodes: (organizationId: string) => [...providerQueryKeys.all, organizationId, 'nodes'] as const,
  nodeSandboxes: (organizationId: string, runnerId: string) =>
    [...providerQueryKeys.all, organizationId, 'nodes', runnerId, 'sandboxes'] as const,
  usage: (organizationId: string, query: ProviderUsageQuery | null) =>
    [...providerQueryKeys.all, organizationId, 'usage', query] as const,
  pricing: (organizationId: string) => [...providerQueryKeys.all, organizationId, 'pricing'] as const,
  earnings: (organizationId: string, query: ProviderEarningsQuery | null) =>
    [...providerQueryKeys.all, organizationId, 'earnings', query] as const,
  settlements: (organizationId: string, query: ProviderSettlementQuery) =>
    [...providerQueryKeys.all, organizationId, 'settlements', query] as const,
  settlement: (organizationId: string, settlementId: string) =>
    [...providerQueryKeys.all, organizationId, 'settlements', settlementId, 'detail'] as const,
  alerts: (organizationId: string, state: ProviderAlertState, limit: number) =>
    [...providerQueryKeys.all, organizationId, 'alerts', state, limit] as const,
}

interface ProviderScope {
  api: ProviderApiClient
  organizationId: string
  enabled: boolean
}

/**
 * 构建 Provider API 客户端（依赖 config.apiUrl + OIDC token + 当前组织）。
 * token 或组织切换时会重建实例，保证请求头始终最新。
 */
export function useProviderApi(): ProviderApiClient {
  const config = useConfig()
  const { user } = useAuth()
  const { selectedOrganization } = useSelectedOrganization()

  const accessToken = user?.access_token ?? ''
  const organizationId = selectedOrganization?.id ?? ''

  return useMemo(
    () =>
      new ProviderApiClient({
        apiUrl: config.apiUrl,
        accessToken,
        organizationId,
      }),
    [config.apiUrl, accessToken, organizationId],
  )
}

function useProviderScope(): ProviderScope {
  const api = useProviderApi()
  const { user } = useAuth()
  const { selectedOrganization } = useSelectedOrganization()
  const organizationId = selectedOrganization?.id ?? ''

  return {
    api,
    organizationId,
    enabled: Boolean(organizationId && user?.access_token),
  }
}

export function useProviderNodesQuery(options?: { refetchInterval?: number | false }) {
  const { api, organizationId, enabled } = useProviderScope()

  return useQuery<ProviderNodesResponse>({
    queryKey: providerQueryKeys.nodes(organizationId),
    queryFn: () => api.listNodes(),
    enabled,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval ?? false,
  })
}

export function useProviderNodeSandboxesQuery(runnerId: string) {
  const { api, organizationId, enabled } = useProviderScope()

  return useQuery<ProviderNodeSandboxesResponse>({
    queryKey: providerQueryKeys.nodeSandboxes(organizationId, runnerId),
    queryFn: () => api.listNodeSandboxes(runnerId),
    enabled: enabled && Boolean(runnerId),
    staleTime: 10_000,
  })
}

export function useProviderUsageQuery(query: ProviderUsageQuery | null) {
  const { api, organizationId, enabled } = useProviderScope()

  return useQuery<ProviderUsageResponse>({
    queryKey: providerQueryKeys.usage(organizationId, query),
    queryFn: () => {
      if (!query) {
        throw new Error('Missing usage query')
      }

      return api.getUsage(query)
    },
    enabled: enabled && Boolean(query?.from && query?.to),
    staleTime: 30_000,
  })
}

export function useProviderPricingQuery(enabled = true) {
  const { api, organizationId, enabled: scopeEnabled } = useProviderScope()

  return useQuery<ProviderPricingResponse>({
    queryKey: providerQueryKeys.pricing(organizationId),
    queryFn: () => api.getPricing(),
    enabled: enabled && scopeEnabled,
    staleTime: 30_000,
  })
}

export function useProviderEarningsQuery(query: ProviderEarningsQuery | null, enabled = true) {
  const { api, organizationId, enabled: scopeEnabled } = useProviderScope()

  return useQuery<ProviderEarningsResponse>({
    queryKey: providerQueryKeys.earnings(organizationId, query),
    queryFn: () => {
      if (!query) {
        throw new Error('Missing earnings query')
      }

      return api.getEarnings(query)
    },
    enabled: enabled && scopeEnabled && Boolean(query?.from && query?.to),
    staleTime: 30_000,
  })
}

export function useProviderSettlementsQuery(query: ProviderSettlementQuery = {}) {
  const { api, organizationId, enabled: scopeEnabled } = useProviderScope()

  return useQuery<ProviderSettlementsResponse>({
    queryKey: providerQueryKeys.settlements(organizationId, query),
    queryFn: () => api.listSettlements(query),
    enabled: scopeEnabled,
    staleTime: 30_000,
  })
}

export function useProviderSettlementQuery(settlementId: string | null) {
  const { api, organizationId, enabled: scopeEnabled } = useProviderScope()

  return useQuery<ProviderSettlementDetail>({
    queryKey: providerQueryKeys.settlement(organizationId, settlementId ?? ''),
    queryFn: () => {
      if (!settlementId) {
        throw new Error('Missing settlement id')
      }

      return api.getSettlement(settlementId)
    },
    enabled: scopeEnabled && Boolean(settlementId),
    staleTime: 30_000,
  })
}

export function useProviderAlertsQuery(state: ProviderAlertState, limit = 50) {
  const { api, organizationId, enabled: scopeEnabled } = useProviderScope()

  return useQuery<ProviderAlertsResponse>({
    queryKey: providerQueryKeys.alerts(organizationId, state, limit),
    queryFn: () => api.listAlerts({ state, limit }),
    enabled: scopeEnabled,
    staleTime: 10_000,
  })
}

interface UpdatePricingVariables {
  runnerId: string
  payload: UpdateProviderPricingPayload
}

export function useUpdateProviderPricingMutation() {
  const { api, organizationId } = useProviderScope()
  const queryClient = useQueryClient()

  return useMutation<void, unknown, UpdatePricingVariables>({
    mutationFn: ({ runnerId, payload }) => api.updatePricing(runnerId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...providerQueryKeys.all, organizationId] })
    },
  })
}

interface UpdateSettlementStatusVariables {
  settlementId: string
  status: ProviderSettlementStatus
}

export function useUpdateSettlementStatusMutation() {
  const { api, organizationId } = useProviderScope()
  const queryClient = useQueryClient()

  return useMutation<void, unknown, UpdateSettlementStatusVariables>({
    mutationFn: ({ settlementId, status }) => api.updateSettlementStatus(settlementId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...providerQueryKeys.all, organizationId] })
    },
  })
}

export function useResolveProviderAlertMutation() {
  const { api, organizationId } = useProviderScope()
  const queryClient = useQueryClient()

  return useMutation<void, unknown, string>({
    mutationFn: (alertId) => api.resolveAlert(alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...providerQueryKeys.all, organizationId] })
    },
  })
}
