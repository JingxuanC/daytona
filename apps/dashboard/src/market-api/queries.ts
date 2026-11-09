/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { useConfig } from '@/hooks/useConfig'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useAuth } from 'react-oidc-context'
import { MarketApiClient } from './client'
import type {
  CreateMarketBidPayload,
  MarketAlertsResponse,
  MarketBidsResponse,
  MarketChargesQuery,
  MarketChargesResponse,
  MarketCreditResponse,
  MarketLeasesResponse,
  MarketListingSort,
  MarketListingsResponse,
  MarketUsageQuery,
  MarketOverview,
  MarketSettings,
  MarketSlaEventsResponse,
  MarketUsageResponse,
  OpenMarketLeasePayload,
  PublishMarketListingPayload,
  UpdateMarketListingPayload,
} from './types'

export const marketQueryKeys = {
  all: ['market'] as const,
  listings: (organizationId: string, sort: MarketListingSort = 'newest') =>
    [...marketQueryKeys.all, organizationId, 'listings', sort] as const,
  leases: (organizationId: string) => [...marketQueryKeys.all, organizationId, 'leases'] as const,
  credit: (organizationId: string) => [...marketQueryKeys.all, organizationId, 'credit'] as const,
  charges: (organizationId: string, query: MarketChargesQuery | null) =>
    [...marketQueryKeys.all, organizationId, 'charges', query] as const,
  usage: (organizationId: string, query: MarketUsageQuery | null) =>
    [...marketQueryKeys.all, organizationId, 'usage', query] as const,
  providerListings: (organizationId: string) =>
    [...marketQueryKeys.all, organizationId, 'provider', 'listings'] as const,
  providerLeases: (organizationId: string) => [...marketQueryKeys.all, organizationId, 'provider', 'leases'] as const,
}

interface MarketScope {
  api: MarketApiClient
  organizationId: string
  enabled: boolean
}

function useMarketApi(): MarketApiClient {
  const config = useConfig()
  const { user } = useAuth()
  const { selectedOrganization } = useSelectedOrganization()

  const accessToken = user?.access_token ?? ''
  const organizationId = selectedOrganization?.id ?? ''

  return useMemo(
    () =>
      new MarketApiClient({
        apiUrl: config.apiUrl,
        accessToken,
        organizationId,
      }),
    [config.apiUrl, accessToken, organizationId],
  )
}

function useMarketScope(): MarketScope {
  const api = useMarketApi()
  const { user } = useAuth()
  const { selectedOrganization } = useSelectedOrganization()
  const organizationId = selectedOrganization?.id ?? ''

  return {
    api,
    organizationId,
    enabled: Boolean(organizationId && user?.access_token),
  }
}

export function useMarketListingsQuery(sort: MarketListingSort = 'newest') {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketListingsResponse>({
    queryKey: marketQueryKeys.listings(organizationId, sort),
    queryFn: () => api.listListings(sort),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketLeasesQuery() {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketLeasesResponse>({
    queryKey: marketQueryKeys.leases(organizationId),
    queryFn: () => api.listLeases(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketUsageQuery(query: MarketUsageQuery | null) {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketUsageResponse>({
    queryKey: marketQueryKeys.usage(organizationId, query),
    queryFn: () => {
      if (!query) {
        throw new Error('Missing market usage query')
      }
      return api.getUsage(query)
    },
    enabled: enabled && Boolean(query?.from && query?.to),
    staleTime: 30_000,
  })
}

export function useMarketCreditQuery() {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketCreditResponse>({
    queryKey: marketQueryKeys.credit(organizationId),
    queryFn: () => api.getCredit(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketChargesQuery(query: MarketChargesQuery | null) {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketChargesResponse>({
    queryKey: marketQueryKeys.charges(organizationId, query),
    queryFn: () => {
      if (!query) {
        throw new Error('Missing market charges query')
      }
      return api.listCharges(query)
    },
    enabled: enabled && Boolean(query?.from && query?.to),
    staleTime: 30_000,
  })
}

export function useOpenMarketLeaseMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: OpenMarketLeasePayload) => api.openLease(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.leases(organizationId) })
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.listings(organizationId) })
    },
  })
}

export function useCloseMarketLeaseMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (leaseId: string) => api.closeLease(leaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.leases(organizationId) })
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.listings(organizationId) })
    },
  })
}

export function useProviderMarketListingsQuery(enabled = true) {
  const { api, organizationId, enabled: scopeEnabled } = useMarketScope()

  return useQuery<MarketListingsResponse>({
    queryKey: marketQueryKeys.providerListings(organizationId),
    queryFn: () => api.listProviderListings(),
    enabled: enabled && scopeEnabled,
    staleTime: 15_000,
  })
}

export function useProviderMarketLeasesQuery(enabled = true) {
  const { api, organizationId, enabled: scopeEnabled } = useMarketScope()

  return useQuery<MarketLeasesResponse>({
    queryKey: marketQueryKeys.providerLeases(organizationId),
    queryFn: () => api.listProviderLeases(),
    enabled: enabled && scopeEnabled,
    staleTime: 15_000,
  })
}

export function usePublishMarketListingMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: PublishMarketListingPayload) => api.publishListing(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.providerListings(organizationId) })
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.listings(organizationId) })
    },
  })
}

export function useUpdateMarketListingMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ listingId, payload }: { listingId: string; payload: UpdateMarketListingPayload }) =>
      api.updateListing(listingId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.providerListings(organizationId) })
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.listings(organizationId) })
    },
  })
}

export function useRetireMarketListingMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (listingId: string) => api.retireListing(listingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.providerListings(organizationId) })
      queryClient.invalidateQueries({ queryKey: marketQueryKeys.listings(organizationId) })
    },
  })
}

export function useMarketAlertsQuery() {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketAlertsResponse>({
    queryKey: [...marketQueryKeys.all, organizationId, 'alerts'],
    queryFn: () => api.listAlerts(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketSlaEventsQuery(query: { from?: string; to?: string } | null) {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketSlaEventsResponse>({
    queryKey: [...marketQueryKeys.all, organizationId, 'sla', query],
    queryFn: () => {
      if (!query) {
        throw new Error('Missing SLA query')
      }
      return api.listSlaEvents(query)
    },
    enabled: enabled && Boolean(query?.from && query?.to),
    staleTime: 30_000,
  })
}

export function useMarketBidsQuery() {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketBidsResponse>({
    queryKey: [...marketQueryKeys.all, organizationId, 'bids'],
    queryFn: () => api.listBids(),
    enabled,
    staleTime: 15_000,
  })
}

export function useCreateMarketBidMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateMarketBidPayload) => api.createBid(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...marketQueryKeys.all, organizationId, 'bids'] })
    },
  })
}

export function useWithdrawMarketBidMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bidId: string) => api.withdrawBid(bidId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...marketQueryKeys.all, organizationId, 'bids'] })
    },
  })
}

export function useProviderMarketBidsQuery(enabled = true) {
  const { api, organizationId, enabled: scopeEnabled } = useMarketScope()

  return useQuery<MarketBidsResponse>({
    queryKey: [...marketQueryKeys.all, organizationId, 'provider', 'bids'],
    queryFn: () => api.listProviderBids(),
    enabled: enabled && scopeEnabled,
    staleTime: 15_000,
  })
}

export function useAcceptMarketBidMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bidId: string) => api.acceptBid(bidId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...marketQueryKeys.all, organizationId, 'provider'] })
    },
  })
}

export function useRejectMarketBidMutation() {
  const { api, organizationId } = useMarketScope()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bidId: string) => api.rejectBid(bidId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...marketQueryKeys.all, organizationId, 'provider', 'bids'] })
    },
  })
}

export function useMarketSettingsQuery() {
  const { api } = useMarketScope()

  return useQuery<MarketSettings>({
    queryKey: ['market', 'admin', 'settings'],
    queryFn: () => api.getSettings(),
    staleTime: 30_000,
    retry: false,
  })
}

export function useMarketOverviewQuery(enabled = true) {
  const { api } = useMarketScope()

  return useQuery<MarketOverview>({
    queryKey: ['market', 'admin', 'overview'],
    queryFn: () => api.getOverview(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  })
}

export function useUpdateMarketSettingsMutation() {
  const queryClient = useQueryClient()
  const { api } = useMarketScope()

  return useMutation({
    mutationFn: (platformFeeBps: number) => api.updateSettings(platformFeeBps),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market', 'admin', 'settings'] })
      queryClient.invalidateQueries({ queryKey: ['market', 'admin', 'overview'] })
    },
  })
}

export function useAdminMarketTopupMutation() {
  const queryClient = useQueryClient()
  const { api } = useMarketScope()

  return useMutation({
    mutationFn: ({
      organizationId,
      amountCents,
      description,
    }: {
      organizationId: string
      amountCents: number
      description?: string
    }) => api.topUp(organizationId, amountCents, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market', 'admin', 'overview'] })
    },
  })
}

export function useRunMarketRiskMutation() {
  const queryClient = useQueryClient()
  const { api } = useMarketScope()

  return useMutation({
    mutationFn: () => api.runRiskControl(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market', 'admin', 'overview'] })
    },
  })
}
