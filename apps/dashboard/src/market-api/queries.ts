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
  MarketLeasesResponse,
  MarketListingsResponse,
  MarketUsageQuery,
  MarketUsageResponse,
  OpenMarketLeasePayload,
  PublishMarketListingPayload,
  UpdateMarketListingPayload,
} from './types'

export const marketQueryKeys = {
  all: ['market'] as const,
  listings: (organizationId: string) => [...marketQueryKeys.all, organizationId, 'listings'] as const,
  leases: (organizationId: string) => [...marketQueryKeys.all, organizationId, 'leases'] as const,
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

export function useMarketListingsQuery() {
  const { api, organizationId, enabled } = useMarketScope()

  return useQuery<MarketListingsResponse>({
    queryKey: marketQueryKeys.listings(organizationId),
    queryFn: () => api.listListings(),
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
