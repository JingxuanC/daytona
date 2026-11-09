/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import axios, { type AxiosInstance } from 'axios'
import type {
  ProviderAlertsQuery,
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

export interface ProviderApiClientOptions {
  /** 通常是 `config.apiUrl`（已包含 `/api` 前缀） */
  apiUrl: string
  /** OIDC access token（`useAuth().user.access_token`） */
  accessToken: string
  /** 当前组织 ID，写入 `X-Daytona-Organization-ID` 请求头 */
  organizationId?: string | null
}

export interface ProviderApiErrorPayload {
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

function toQueryValue(value: string | number | undefined | null): string | number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return value
}

/**
 * 算力提供方控制台 API 客户端。
 *
 * 独立于自动生成的 `@daytona/api-client`：Provider API 尚未进入 OpenAPI 生成流程，
 * 这里直接使用 axios + `config.apiUrl`，并附带 OIDC token 与组织请求头。
 */
export class ProviderApiClient {
  private readonly http: AxiosInstance

  constructor(options: ProviderApiClientOptions) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }

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

  async listNodes(): Promise<ProviderNodesResponse> {
    const { data } = await this.http.get<ProviderNodesResponse>('/provider/nodes')
    return data
  }

  async listNodeSandboxes(runnerId: string): Promise<ProviderNodeSandboxesResponse> {
    const { data } = await this.http.get<ProviderNodeSandboxesResponse>(
      `/provider/nodes/${encodeURIComponent(runnerId)}/sandboxes`,
    )
    return data
  }

  async getUsage(query: ProviderUsageQuery): Promise<ProviderUsageResponse> {
    const { data } = await this.http.get<ProviderUsageResponse>('/provider/usage', {
      params: {
        from: query.from,
        to: query.to,
        granularity: toQueryValue(query.granularity),
        runnerId: toQueryValue(query.runnerId),
      },
    })
    return data
  }

  async getPricing(): Promise<ProviderPricingResponse> {
    const { data } = await this.http.get<ProviderPricingResponse>('/provider/pricing')
    return data
  }

  async updatePricing(runnerId: string, payload: UpdateProviderPricingPayload): Promise<void> {
    await this.http.put(`/provider/pricing/${encodeURIComponent(runnerId)}`, payload)
  }

  async getEarnings(query: ProviderEarningsQuery): Promise<ProviderEarningsResponse> {
    const { data } = await this.http.get<ProviderEarningsResponse>('/provider/earnings', {
      params: {
        from: query.from,
        to: query.to,
        runnerId: toQueryValue(query.runnerId),
      },
    })
    return data
  }

  async listSettlements(query: ProviderSettlementQuery = {}): Promise<ProviderSettlementsResponse> {
    const { data } = await this.http.get<ProviderSettlementsResponse>('/provider/settlements', {
      params: {
        status: toQueryValue(query.status),
        from: toQueryValue(query.from),
        to: toQueryValue(query.to),
        runnerId: toQueryValue(query.runnerId),
      },
    })
    return data
  }

  async getSettlement(settlementId: string): Promise<ProviderSettlementDetail> {
    const { data } = await this.http.get<ProviderSettlementDetail>(
      `/provider/settlements/${encodeURIComponent(settlementId)}`,
    )
    return data
  }

  async updateSettlementStatus(settlementId: string, status: ProviderSettlementStatus): Promise<void> {
    await this.http.patch(`/provider/settlements/${encodeURIComponent(settlementId)}/status`, { status })
  }

  async listAlerts(query: ProviderAlertsQuery = {}): Promise<ProviderAlertsResponse> {
    const { data } = await this.http.get<ProviderAlertsResponse>('/provider/alerts', {
      params: {
        state: toQueryValue(query.state),
        limit: toQueryValue(query.limit),
      },
    })
    return data
  }

  async resolveAlert(alertId: string): Promise<void> {
    await this.http.post(`/provider/alerts/${encodeURIComponent(alertId)}/resolve`)
  }
}

function extractServerMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return payload.trim() || undefined
  }

  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }

  const message = (payload as ProviderApiErrorPayload).message

  if (Array.isArray(message)) {
    const messages = message.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return messages.length > 0 ? messages.join('；') : undefined
  }

  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim()
  }

  const error = (payload as ProviderApiErrorPayload).error
  return typeof error === 'string' && error.trim().length > 0 ? error.trim() : undefined
}

/**
 * 把任意请求错误转换成适合展示给用户的中文文案。
 * Provider API 未部署时通常返回 404，这里给出更明确的提示而不是 axios 原始信息。
 */
export function getProviderApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const serverMessage = extractServerMessage(error.response?.data)

    if (status === 404) {
      return '接口暂不可用（404），后端算力控制台 API 可能尚未部署'
    }

    if (status === 401 || status === 403) {
      return serverMessage ?? '没有权限执行该操作，请确认登录状态与组织权限'
    }

    if (serverMessage) {
      return serverMessage
    }

    if (status === 400) {
      return '请求参数不合法，请检查输入后重试'
    }

    if (error.code === 'ERR_NETWORK') {
      return '无法连接后端服务，请检查网络或服务状态'
    }

    return error.message || fallback
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
