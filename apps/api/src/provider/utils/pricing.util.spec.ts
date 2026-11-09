/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { computeAmountCents } from './pricing.util'

describe('pricing.util', () => {
  const pricing = {
    cpuHourCents: 10,
    memoryGiBHourCents: 2,
    diskGiBHourCents: 1,
    gpuHourCents: 500,
  }

  it('computes the amount in integer cents', () => {
    const amount = computeAmountCents(
      { cpuHours: 2, memoryGiBHours: 4, diskGiBHours: 10, gpuHours: 0.5 },
      pricing,
    )

    expect(amount).toBe(2 * 10 + 4 * 2 + 10 * 1 + 0.5 * 500)
    expect(Number.isInteger(amount)).toBe(true)
  })

  it('rounds fractional cents', () => {
    expect(computeAmountCents({ cpuHours: 0.25, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0 }, pricing)).toBe(3)
  })

  it('returns zero when the node has no pricing', () => {
    expect(
      computeAmountCents({ cpuHours: 100, memoryGiBHours: 100, diskGiBHours: 100, gpuHours: 1 }, null),
    ).toBe(0)
  })
})
