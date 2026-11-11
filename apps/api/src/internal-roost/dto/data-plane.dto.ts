/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/** Data-plane proxy kind, one per internal route family. */
export type RoostDataPlaneKind = 'toolbox' | 'preview'

export interface ResolveDataPlaneTargetParams {
  kind: RoostDataPlaneKind
  /** Daytona sandbox id from the URL (not an `sbx_` token). */
  sandboxId: string
  /** Organization from the JWT `org_id` claim. */
  orgId: string
  /** Raw request URL from the internal listener, e.g. `/internal/roost/v1/sandboxes/...`. */
  originalUrl: string
}

export interface ResolvedDataPlaneTarget {
  kind: RoostDataPlaneKind
  sandboxId: string
  runnerId: string
  /** Full upstream URL including path and query string. */
  targetUrl: string
  /** Headers to add when forwarding (never derived from the client). */
  upstreamHeaders: Record<string, string>
}

export interface BuiltDataPlaneUpstreamUrl {
  url: string
  port?: number
}

/** Parsed WebSocket upgrade request for the internal data plane. */
export interface ParsedDataPlaneUpgradeRequest {
  kind: RoostDataPlaneKind
  sandboxId: string
  /** Raw path after `.../{kind}`, e.g. `/3000/ws` (never decoded). */
  restPath: string
  /** Raw query string without the leading `?`. */
  rawQuery: string
}

/** Hop-by-hop headers that must never be forwarded in either direction. */
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
