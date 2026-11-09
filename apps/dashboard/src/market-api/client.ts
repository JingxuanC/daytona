/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import axios, { type AxiosInstance } from 'axios'
import type {
  MarketChargesQuery,
  MarketChargesResponse,
  MarketCreditResponse,
  MarketLease,
  MarketLeasesResponse,
  MarketListingsResponse,
  MarketListingSort,
  MarketUsageQuery,
  MarketUsageResponse,
  OpenMarketLeasePayload,
  PublishMarketListingPayload,
  UpdateMarketListingPayload,
} from './types'

export interface MarketApiClientOptions {
  apiUrl: string
  accessToken: string
  organizationId?: string | null
}

export interface MarketApiErrorPayload {
  message?: string | string[]
  error?: string
  statusCode?: number
}

function normalizeBaseUrl(apiUrl: string): string {
  const trimmed = (apiUrl ?? '').trim()
  if (!trimmed) {
    return '/api'
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

export function getMarketApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as MarketApiErrorPayload | undefined
    if (payload?.message) {
      return Array.isArray(payload.message) ? payload.message.join(', ') : payload.message
    }
    if (payload?.error) {
      return payload.error
    }
    return error.message
  }
  return error instanceof Error ? error.message : '未知错误'
}

export class MarketApiClient {
  private readonly http: AxiosInstance

  constructor(options: MarketApiClientOptions) {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`
    }
    if (options.organizationId) {
      headers['X-Daytona-Organization-ID'] = options.organizationId
    }
    this.http = axios.create({
      baseURL: normalizeBaseUrl(options.apiUrl),
      headers,
    })
  }

  async listListings(sort?: MarketListingSort): Promise<MarketListingsResponse> {
    const { data } = await this.http.get<MarketListingsResponse>('/market/listings', {
      params: { sort },
    })
    return data
  }

  async listLeases(): Promise<MarketLeasesResponse> {
    const { data } = await this.http.get<MarketLeasesResponse>('/market/leases')
    return data
  }

  async openLease(payload: OpenMarketLeasePayload): Promise<MarketLease> {
    const { data } = await this.http.post<MarketLease>('/market/leases', payload)
    return data
  }

  async closeLease(leaseId: string): Promise<MarketLease> {
    const { data } = await this.http.post<MarketLease>(`/market/leases/${encodeURIComponent(leaseId)}/close`)
    return data
  }

  async getCredit(): Promise<MarketCreditResponse> {
    const { data } = await this.http.get<MarketCreditResponse>('/market/credit')
    return data
  }

  async listCharges(query: MarketChargesQuery): Promise<MarketChargesResponse> {
    const { data } = await this.http.get<MarketChargesResponse>('/market/charges', {
      params: { from: query.from, to: query.to },
    })
    return data
  }

  async getUsage(query: MarketUsageQuery): Promise<MarketUsageResponse> {
    const { data } = await this.http.get<MarketUsageResponse>('/market/usage', {
      params: { from: query.from, to: query.to },
    })
    return data
  }

  async listProviderListings(): Promise<MarketListingsResponse> {
    const { data } = await this.http.get<MarketListingsResponse>('/provider/market/listings')
    return data
  }

  async publishListing(payload: PublishMarketListingPayload): Promise<unknown> {
    const { data } = await this.http.post('/provider/market/listings', payload)
    return data
  }

  async updateListing(listingId: string, payload: UpdateMarketListingPayload): Promise<unknown> {
    const { data } = await this.http.patch(`/provider/market/listings/${encodeURIComponent(listingId)}`, payload)
    return data
  }

  async retireListing(listingId: string): Promise<unknown> {
    const { data } = await this.http.delete(`/provider/market/listings/${encodeURIComponent(listingId)}`)
    return data
  }

  async listProviderLeases(): Promise<MarketLeasesResponse> {
    const { data } = await this.http.get<MarketLeasesResponse>('/provider/market/leases')
    return data
  }
}
