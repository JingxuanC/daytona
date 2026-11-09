/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { DAY_MS, formatUtcDay, resolveDateRange, round, startOfUtcDay } from './date-range.util'

describe('date-range.util', () => {
  it('resolves an inclusive explicit range', () => {
    const range = resolveDateRange('2026-11-01', '2026-11-09')

    expect(range.fromLabel).toBe('2026-11-01')
    expect(range.toLabel).toBe('2026-11-09')
    expect(range.from.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    // `to` is exclusive: the day after the requested end date
    expect(range.to.toISOString()).toBe('2026-11-10T00:00:00.000Z')
    expect(range.to.getTime() - range.from.getTime()).toBe(9 * DAY_MS)
  })

  it('defaults from to 7 days ending on the given to date', () => {
    const range = resolveDateRange(undefined, '2026-11-09')

    expect(range.fromLabel).toBe('2026-11-03')
    expect(range.toLabel).toBe('2026-11-09')
    expect(range.to.getTime() - range.from.getTime()).toBe(7 * DAY_MS)
  })

  it('normalizes a to day with time component to UTC midnight', () => {
    const range = resolveDateRange('2026-11-01', '2026-11-09T18:30:00.000Z')

    expect(range.toLabel).toBe('2026-11-09')
    expect(range.to.toISOString()).toBe('2026-11-10T00:00:00.000Z')
  })

  it('start of UTC day and formatting helpers agree', () => {
    const date = new Date('2026-11-09T23:59:59.999Z')

    expect(startOfUtcDay(date).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(formatUtcDay(date)).toBe('2026-11-09')
  })

  it('rounds to the requested number of decimals', () => {
    expect(round(1.23456)).toBe(1.2346)
    expect(round(1.23456, 2)).toBe(1.23)
    expect(round(0.00004)).toBe(0)
  })
})
