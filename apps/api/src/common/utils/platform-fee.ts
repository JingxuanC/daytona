/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

const DEFAULT_PLATFORM_FEE_BPS = 0

/**
 * Platform commission on compute market revenue, in basis points (1 bps = 0.01%).
 * Configured by `MARKET_PLATFORM_FEE_BPS` (0-10000); invalid values fall back to 0.
 */
export function platformFeeBpsFromEnv(): number {
  const raw = process.env.MARKET_PLATFORM_FEE_BPS
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PLATFORM_FEE_BPS
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
    return DEFAULT_PLATFORM_FEE_BPS
  }
  return Math.floor(parsed)
}
