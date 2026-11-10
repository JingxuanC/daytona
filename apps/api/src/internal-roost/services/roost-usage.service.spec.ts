/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException } from '@nestjs/common'
import { parseUsageWindow, RoostUsageService } from './roost-usage.service'

interface FakePeriod {
  sandboxId: string
  organizationId: string
  startAt: Date
  endAt: Date | null
  cpu: number
  mem: number
  disk: number
  gpu: number
}

function createService(periods: FakePeriod[]) {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => periods),
  }
  const repository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  }
  return {
    service: new RoostUsageService(repository as any),
    repository,
    queryBuilder,
  }
}

const basePeriod: FakePeriod = {
  sandboxId: 'sbx-1',
  organizationId: 'org-1',
  startAt: new Date('2026-11-10T10:00:00.000Z'),
  endAt: new Date('2026-11-10T12:00:00.000Z'),
  cpu: 2,
  mem: 4,
  disk: 10,
  gpu: 0,
}

describe('RoostUsageService', () => {
  it('returns integer weighted seconds from sandbox usage periods', async () => {
    const { service } = createService([basePeriod])

    const result = await service.getUsage('org-1', '2026-11-10T10:00:00.000Z', '2026-11-10T12:00:00.000Z')

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      sandbox_id: 'sbx-1',
      period_start: '2026-11-10T10:00:00.000Z',
      period_end: '2026-11-10T12:00:00.000Z',
      cpu_seconds: 2 * 7200,
      memory_mib_seconds: 4 * 1024 * 7200,
      disk_mib_seconds: 10 * 1024 * 7200,
      gpu_seconds: 0,
    })
  })

  it('clips periods to the requested window', async () => {
    const { service } = createService([basePeriod])

    const result = await service.getUsage('org-1', '2026-11-10T10:30:00.000Z', '2026-11-10T11:00:00.000Z')

    expect(result.items[0]).toMatchObject({
      period_start: '2026-11-10T10:30:00.000Z',
      period_end: '2026-11-10T11:00:00.000Z',
      cpu_seconds: 2 * 1800,
    })
  })

  it('merges periods per sandbox when group_by=sandbox', async () => {
    const secondPeriod: FakePeriod = {
      ...basePeriod,
      startAt: new Date('2026-11-10T12:00:00.000Z'),
      endAt: new Date('2026-11-10T13:00:00.000Z'),
      cpu: 4,
    }
    const { service } = createService([basePeriod, { ...secondPeriod, sandboxId: 'sbx-2' }, secondPeriod])

    const result = await service.getUsage(
      'org-1',
      '2026-11-10T10:00:00.000Z',
      '2026-11-10T13:00:00.000Z',
      'sandbox',
    )

    expect(result.items).toHaveLength(2)
    // sbx-1 has both periods merged (10:00-13:00), sbx-2 only the second one.
    expect(result.items[0]).toMatchObject({
      sandbox_id: 'sbx-1',
      period_start: '2026-11-10T10:00:00.000Z',
      period_end: '2026-11-10T13:00:00.000Z',
      cpu_seconds: 2 * 7200 + 4 * 3600,
    })
    expect(result.items[1]).toMatchObject({
      sandbox_id: 'sbx-2',
      period_start: '2026-11-10T12:00:00.000Z',
      period_end: '2026-11-10T13:00:00.000Z',
      cpu_seconds: 4 * 3600,
    })
  })

  it('rejects an invalid group_by and an inverted window', async () => {
    const { service } = createService([])
    await expect(
      service.getUsage('org-1', '2026-11-10T10:00:00.000Z', '2026-11-10T12:00:00.000Z', 'day'),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.getUsage('org-1', '2026-11-10T12:00:00.000Z', '2026-11-10T10:00:00.000Z'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('parseUsageWindow', () => {
  it('accepts ISO date-times and unix seconds', () => {
    const iso = parseUsageWindow('2026-11-10T10:00:00.000Z', '2026-11-10T12:00:00.000Z')
    expect(iso.from.toISOString()).toBe('2026-11-10T10:00:00.000Z')

    const unix = parseUsageWindow('1794300000', '1794303600')
    expect(unix.from.getTime()).toBe(1794300000 * 1000)
  })

  it('rejects missing/invalid values', () => {
    expect(() => parseUsageWindow(undefined as any, '2026-11-10T12:00:00.000Z')).toThrow(BadRequestException)
    expect(() => parseUsageWindow('nope', '2026-11-10T12:00:00.000Z')).toThrow(BadRequestException)
  })
})
