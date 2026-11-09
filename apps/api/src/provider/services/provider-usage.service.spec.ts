/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { InMemoryRepository, makeUsagePeriod } from '../../test/helpers/provider-test.helper'
import { ProviderUsageService } from './provider-usage.service'

describe('ProviderUsageService (acceptance)', () => {
  const runnerService = {
    findByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: `node-${id}` }))),
    // Provider usage is attributed to the organization's runners (compute market M2).
    findAllByOrganization: jest.fn(async () => [
      { id: 'runner-1', name: 'node-runner-1' },
      { id: 'runner-2', name: 'node-runner-2' },
    ]),
  }

  const createService = (current: Record<string, any>[], archived: Record<string, any>[] = []) => {
    const currentRepository = new InMemoryRepository(current)
    const archiveRepository = new InMemoryRepository(archived)
    const service = new ProviderUsageService(
      currentRepository as any,
      archiveRepository as any,
      runnerService as any,
    )
    return { service, currentRepository, archiveRepository }
  }

  it('splits a cross-day usage period into daily buckets', async () => {
    const { service } = createService([
      makeUsagePeriod({
        startAt: new Date('2026-11-08T12:00:00.000Z'),
        endAt: new Date('2026-11-09T12:00:00.000Z'),
        cpu: 2,
        mem: 4,
        disk: 10,
      }),
    ])

    const result = await service.getUsage('org-1', {
      from: '2026-11-08',
      to: '2026-11-09',
      granularity: 'day',
    })

    expect(result.items).toHaveLength(2)
    const day09 = result.items.find((item) => item.date === '2026-11-09')
    const day08 = result.items.find((item) => item.date === '2026-11-08')

    expect(day09).toMatchObject({
      runnerId: 'runner-1',
      runnerName: 'node-runner-1',
      cpuHours: 24,
      memoryGiBHours: 48,
      diskGiBHours: 120,
      sandboxCount: 1,
    })
    expect(day08).toMatchObject({ cpuHours: 24, memoryGiBHours: 48, diskGiBHours: 120 })

    expect(result.totals).toEqual({
      cpuHours: 48,
      memoryGiBHours: 96,
      diskGiBHours: 240,
      gpuHours: 0,
      sandboxCount: 1,
    })
    expect(result.from).toBe('2026-11-08')
    expect(result.to).toBe('2026-11-09')
    expect(result.currency).toBe('CNY')
  })

  it('includes archived usage periods', async () => {
    const { service } = createService(
      [],
      [
        makeUsagePeriod({
          startAt: new Date('2026-11-07T00:00:00.000Z'),
          endAt: new Date('2026-11-08T00:00:00.000Z'),
          cpu: 1,
          mem: 0,
          disk: 0,
        }),
      ],
    )

    const result = await service.getUsage('org-1', { from: '2026-11-07', to: '2026-11-07' })

    expect(result.totals.cpuHours).toBe(24)
    expect(result.items[0]).toMatchObject({ date: '2026-11-07', cpuHours: 24 })
  })

  it('filters by runner and only reports that node', async () => {
    const { service } = createService([
      makeUsagePeriod({ runnerId: 'runner-1', cpu: 1, mem: 0, disk: 0 }),
      makeUsagePeriod({ runnerId: 'runner-2', sandboxId: 'sandbox-2', cpu: 1, mem: 0, disk: 0 }),
    ])

    const result = await service.getUsage('org-1', { from: '2026-11-08', to: '2026-11-08', runnerId: 'runner-1' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ runnerId: 'runner-1', cpuHours: 24 })
    expect(result.totals.sandboxCount).toBe(1)
  })

  it('clips open-ended usage periods to the requested window', async () => {
    const { service } = createService([
      makeUsagePeriod({
        startAt: new Date('2026-11-01T00:00:00.000Z'),
        endAt: null,
        cpu: 1,
        mem: 0,
        disk: 0,
      }),
    ])

    const result = await service.getUsage('org-1', { from: '2026-11-01', to: '2026-11-01' })

    expect(result.items).toHaveLength(1)
    expect(result.totals.cpuHours).toBe(24)
  })

  it('supports granularity=total', async () => {
    const { service } = createService([
      makeUsagePeriod({
        startAt: new Date('2026-11-08T12:00:00.000Z'),
        endAt: new Date('2026-11-09T12:00:00.000Z'),
        cpu: 2,
        mem: 0,
        disk: 0,
      }),
    ])

    const result = await service.getUsage('org-1', {
      from: '2026-11-08',
      to: '2026-11-09',
      granularity: 'total',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ date: null, cpuHours: 48 })
  })

  it('rejects an inverted date range', async () => {
    const { service } = createService([])

    await expect(service.getUsage('org-1', { from: '2026-11-09', to: '2026-11-01' })).rejects.toThrow(
      /Invalid date range/,
    )
  })
})
