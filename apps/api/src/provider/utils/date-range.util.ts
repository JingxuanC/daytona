/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000

export interface ResolvedDateRange {
  /** Inclusive start of the range (UTC midnight) */
  from: Date
  /** Exclusive end of the range (UTC midnight of the day after `to`) */
  to: Date
  /** Inclusive start date label, YYYY-MM-DD */
  fromLabel: string
  /** Inclusive end date label, YYYY-MM-DD */
  toLabel: string
}

export function startOfUtcDay(date: Date): Date {
  const copy = new Date(date.getTime())
  copy.setUTCHours(0, 0, 0, 0)
  return copy
}

export function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Resolves an inclusive [from, to] day range. `to` defaults to today and `from` defaults to
 * `to - (defaultDays - 1)`, so a default of 7 returns the last 7 days including today.
 * Both dates are interpreted in UTC.
 */
export function resolveDateRange(from?: string, to?: string, defaultDays = 7): ResolvedDateRange {
  const now = new Date()
  const toDay = to ? startOfUtcDay(new Date(to)) : startOfUtcDay(now)

  let fromDay: Date
  if (from) {
    fromDay = startOfUtcDay(new Date(from))
  } else {
    fromDay = new Date(toDay.getTime() - (defaultDays - 1) * DAY_MS)
  }

  if (Number.isNaN(fromDay.getTime()) || Number.isNaN(toDay.getTime())) {
    throw new Error('Invalid date range')
  }

  const toExclusive = new Date(toDay.getTime() + DAY_MS)

  return {
    from: fromDay,
    to: toExclusive,
    fromLabel: formatUtcDay(fromDay),
    toLabel: formatUtcDay(toDay),
  }
}

/**
 * Rounds an accumulated float (hours, currency amounts) to avoid leaking floating point
 * noise into API responses.
 */
export function round(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
