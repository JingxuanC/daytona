/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException } from '@nestjs/common'
import { InMemoryRepository, makePricing } from '../../test/helpers/provider-test.helper'
import { SettlementStatus } from '../entities/settlement-period.entity'
import { ProviderSettlementService } from './provider-settlement.service'

describe('ProviderSettlementService (acceptance)', () => {
  const DAY = '2026-11-08'

  const createService = () => {
    const settlementRepository = new InMemoryRepository<any>()
    const lineRepository = new InMemoryRepository<any>()

    const usageLines = [
      { sandboxId: 'sandbox-1', cpuHours: 1, memoryGiBHours: 2, diskGiBHours: 3, gpuHours: 0 },
      { sandboxId: 'sandbox-2', cpuHours: 2, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0 },
    ]
    const usageService = {
      getRunnerUsage: jest.fn(async () => usageLines),
      getSandboxUsage: jest.fn(async () => [
        { sandboxId: 'sandbox-1', cpuHours: 1, memoryGiBHours: 2, diskGiBHours: 3, gpuHours: 0 },
        { sandboxId: 'sandbox-2', cpuHours: 2, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0 },
      ]),
    }

    const pricingService = {
      getPricingMap: jest.fn(async () => {
        const pricing = makePricing({ cpuHourCents: 100, memoryGiBHourCents: 10, diskGiBHourCents: 1 })
        return new Map<string, any>([[pricing.runnerId, pricing]])
      }),
    }

    const runnerService = {
      findAllByOrganization: jest.fn(async () => [{ id: 'runner-1', name: 'node-1' }]),
      findAllByRegion: jest.fn(async () => []),
      findByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: 'node-1' }))),
    }

    const regionService = { findAllByRegionType: jest.fn(async () => []) }
    const redisLockProvider = {
      lock: jest.fn(async () => true),
      unlock: jest.fn(async () => undefined),
    }

    const service = new ProviderSettlementService(
      settlementRepository as any,
      lineRepository as any,
      runnerService as any,
      regionService as any,
      redisLockProvider as any,
      usageService as any,
      pricingService as any,
      { getPlatformFeeBps: jest.fn(async () => 0) } as any,
    )

    return { service, settlementRepository, lineRepository, usageService, pricingService }
  }

  it('prices a day and stores per-sandbox settlement lines', async () => {
    const { service, settlementRepository, lineRepository } = createService()

    const settled = await service.settleDay(DAY, 'org-1')

    expect(settled).toBe(1)
    expect(settlementRepository.rows).toHaveLength(1)
    const period = settlementRepository.rows[0]
    // sandbox-1: 1*100 + 2*10 + 3*1 = 123 cents, sandbox-2: 2*100 = 200 cents
    expect(period).toMatchObject({
      organizationId: 'org-1',
      runnerId: 'runner-1',
      periodStart: DAY,
      periodEnd: DAY,
      status: SettlementStatus.PENDING,
      amountCents: 323,
      currency: 'CNY',
      cpuHours: 3,
      memoryGiBHours: 2,
      diskGiBHours: 3,
    })

    expect(lineRepository.rows).toHaveLength(2)
    const lineBySandbox = new Map(lineRepository.rows.map((line) => [line.sandboxId, line]))
    expect(lineBySandbox.get('sandbox-1')).toMatchObject({ amountCents: 123, cpuHours: 1 })
    expect(lineBySandbox.get('sandbox-2')).toMatchObject({ amountCents: 200, cpuHours: 2 })
  })

  it('is idempotent for a pending day and does not duplicate lines', async () => {
    const { service, settlementRepository, lineRepository } = createService()

    await service.settleDay(DAY, 'org-1')
    await service.settleDay(DAY, 'org-1')

    expect(settlementRepository.rows).toHaveLength(1)
    expect(lineRepository.rows).toHaveLength(2)
    expect(settlementRepository.rows[0].amountCents).toBe(323)
  })

  it('never overwrites a settlement that was already settled', async () => {
    const { service, settlementRepository } = createService()
    settlementRepository.rows.push({
      id: 'settled-1',
      organizationId: 'org-1',
      runnerId: 'runner-1',
      periodStart: DAY,
      periodEnd: DAY,
      status: SettlementStatus.SETTLED,
      amountCents: 777,
      cpuHours: 0,
      memoryGiBHours: 0,
      diskGiBHours: 0,
      gpuHours: 0,
      currency: 'CNY',
    })

    await service.settleDay(DAY, 'org-1')

    expect(settlementRepository.rows).toHaveLength(1)
    expect(settlementRepository.rows[0]).toMatchObject({ status: SettlementStatus.SETTLED, amountCents: 777 })
  })

  it('marks pending settlements as settled exactly once', async () => {
    const { service, settlementRepository } = createService()
    await service.settleDay(DAY, 'org-1')
    const period = settlementRepository.rows[0]

    await service.markSettled(period.id)

    expect(settlementRepository.rows[0].status).toBe(SettlementStatus.SETTLED)
    expect(settlementRepository.rows[0].settledAt).toBeInstanceOf(Date)

    await expect(service.markSettled(period.id)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('enforces the payout state machine', async () => {
    const { service, settlementRepository } = createService()
    settlementRepository.rows.push({
      id: 'settled-1',
      organizationId: 'org-1',
      runnerId: 'runner-1',
      periodStart: DAY,
      periodEnd: DAY,
      status: SettlementStatus.SETTLED,
      amountCents: 100,
      cpuHours: 0,
      memoryGiBHours: 0,
      diskGiBHours: 0,
      gpuHours: 0,
      currency: 'CNY',
      createdAt: new Date('2026-11-09T00:00:00.000Z'),
    })

    const withdrawing = await service.updateStatus('org-1', 'settled-1', {
      status: SettlementStatus.WITHDRAWING,
    } as any)
    expect(withdrawing.status).toBe(SettlementStatus.WITHDRAWING)

    const withdrawn = await service.updateStatus('org-1', 'settled-1', {
      status: SettlementStatus.WITHDRAWN,
    } as any)
    expect(withdrawn.status).toBe(SettlementStatus.WITHDRAWN)
    expect(withdrawn.withdrawnAt).toBeTruthy()

    // PENDING cannot jump straight to WITHDRAWING
    settlementRepository.rows.push({
      id: 'pending-1',
      organizationId: 'org-1',
      runnerId: 'runner-1',
      periodStart: '2026-11-07',
      periodEnd: '2026-11-07',
      status: SettlementStatus.PENDING,
      amountCents: 100,
      cpuHours: 0,
      memoryGiBHours: 0,
      diskGiBHours: 0,
      gpuHours: 0,
      currency: 'CNY',
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
    })

    await expect(
      service.updateStatus('org-1', 'pending-1', { status: SettlementStatus.WITHDRAWING } as any),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('returns settlement details with per-sandbox lines', async () => {
    const { service, settlementRepository } = createService()
    await service.settleDay(DAY, 'org-1')

    const detail = await service.getSettlementDetail('org-1', settlementRepository.rows[0].id)

    expect(detail.runnerName).toBe('node-1')
    expect(detail.lines).toHaveLength(2)
    expect(detail.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(detail.amountCents)
  })

  it('hides settlements of other organizations', async () => {
    const { service, settlementRepository } = createService()
    await service.settleDay(DAY, 'org-1')

    await expect(service.getSettlementDetail('org-2', settlementRepository.rows[0].id)).rejects.toThrow(
      'Settlement not found',
    )
  })
})
