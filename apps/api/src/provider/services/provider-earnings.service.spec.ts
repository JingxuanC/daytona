/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { InMemoryRepository, makePricing } from '../../test/helpers/provider-test.helper'
import { SettlementStatus } from '../entities/settlement-period.entity'
import { ProviderEarningsService } from './provider-earnings.service'

describe('ProviderEarningsService (acceptance)', () => {
  const createService = () => {
    const usageService = {
      getUsage: jest.fn(async () => ({
        from: '2026-11-08',
        to: '2026-11-09',
        currency: 'CNY',
        items: [
          {
            date: '2026-11-09',
            runnerId: 'runner-1',
            runnerName: 'node-1',
            cpuHours: 2,
            memoryGiBHours: 4,
            diskGiBHours: 10,
            gpuHours: 0,
            sandboxCount: 1,
          },
          {
            date: '2026-11-08',
            runnerId: 'runner-1',
            runnerName: 'node-1',
            cpuHours: 1,
            memoryGiBHours: 2,
            diskGiBHours: 3,
            gpuHours: 0,
            sandboxCount: 2,
          },
        ],
        totals: {
          cpuHours: 3,
          memoryGiBHours: 6,
          diskGiBHours: 13,
          gpuHours: 0,
          sandboxCount: 2,
        },
      })),
    }

    const pricingService = {
      getPricingMap: jest.fn(async () => {
        const pricing = makePricing({ cpuHourCents: 10, memoryGiBHourCents: 2, diskGiBHourCents: 1 })
        return new Map<string, any>([[pricing.runnerId, pricing]])
      }),
    }

    const settlementRepository = new InMemoryRepository<any>([
      {
        id: 'settlement-1',
        organizationId: 'org-1',
        runnerId: 'runner-1',
        periodStart: '2026-11-08',
        periodEnd: '2026-11-08',
        status: SettlementStatus.SETTLED,
        amountCents: 777,
        currency: 'CNY',
      },
    ])

    const service = new ProviderEarningsService(
      settlementRepository as any,
      usageService as any,
      pricingService as any,
    )

    return { service, settlementRepository }
  }

  it('uses settled amounts when available and prices the rest in real time', async () => {
    const { service } = createService()

    const result = await service.getEarnings('org-1', { from: '2026-11-08', to: '2026-11-09' })

    const day08 = result.items.find((item) => item.date === '2026-11-08')
    const day09 = result.items.find((item) => item.date === '2026-11-09')

    // settled day keeps the persisted amount (authoritative)
    expect(day08).toMatchObject({
      amountCents: 777,
      settlementStatus: SettlementStatus.SETTLED,
      settlementId: 'settlement-1',
    })

    // unsettled day is priced live: 2*10 + 4*2 + 10*1 = 38
    expect(day09).toMatchObject({
      amountCents: 38,
      settlementStatus: null,
      settlementId: null,
    })

    expect(result.totals).toMatchObject({ amountCents: 815, cpuHours: 3, memoryGiBHours: 6, diskGiBHours: 13 })
  })

  it('returns empty earnings when there is no usage in the window', async () => {
    const { service } = createService()
    ;(service as any).providerUsageService.getUsage = jest.fn(async () => ({
      from: '2026-11-08',
      to: '2026-11-09',
      currency: 'CNY',
      items: [],
      totals: { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0, sandboxCount: 0 },
    }))

    const result = await service.getEarnings('org-1', {})

    expect(result.items).toHaveLength(0)
    expect(result.totals.amountCents).toBe(0)
  })
})
