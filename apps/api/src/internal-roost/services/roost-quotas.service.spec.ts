/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { RegionQuota } from '../../organization/entities/region-quota.entity'
import { SandboxClass } from '../../sandbox/enums/sandbox-class.enum'
import { RegionQuotaSource } from '../entities/region-quota-source.entity'
import {
  aggregateQuotaSources,
  normalizePutRegionQuotaBody,
  normalizeSandboxClass,
  RoostQuotasService,
} from './roost-quotas.service'

function createFakeDataSource(): any {
  const sourceRows: RegionQuotaSource[] = []
  const quotaRows: RegionQuota[] = []

  const sourceRepository = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        sourceRows.find(
          (row) =>
            row.organizationId === where.organizationId &&
            row.regionId === where.regionId &&
            row.sandboxClass === where.sandboxClass &&
            row.source === where.source,
        ) ?? null
      )
    }),
    find: jest.fn(async ({ where }: any) =>
      sourceRows.filter(
        (row) =>
          row.organizationId === where.organizationId &&
          row.regionId === where.regionId &&
          row.sandboxClass === where.sandboxClass,
      ),
    ),
    save: jest.fn(async (row: RegionQuotaSource) => {
      const existing = sourceRows.find((item) => item.id === row.id)
      if (!existing) {
        row.id = `source-${sourceRows.length + 1}`
        sourceRows.push(row)
      }
      return row
    }),
  }

  const quotaRepository = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        quotaRows.find(
          (row) =>
            row.organizationId === where.organizationId &&
            row.regionId === where.regionId &&
            row.sandboxClass === where.sandboxClass,
        ) ?? null
      )
    }),
    save: jest.fn(async (row: RegionQuota) => {
      if (!quotaRows.includes(row)) {
        quotaRows.push(row)
      }
      return row
    }),
    remove: jest.fn(async (row: RegionQuota) => {
      const index = quotaRows.indexOf(row)
      if (index >= 0) {
        quotaRows.splice(index, 1)
      }
      return row
    }),
  }

  const manager = {
    getRepository: (entity: any) => (entity === RegionQuotaSource ? sourceRepository : quotaRepository),
    delete: jest.fn(async (_entity: any, criteria: any) => {
      for (let index = sourceRows.length - 1; index >= 0; index -= 1) {
        const row = sourceRows[index]
        if (
          row.organizationId === criteria.organizationId &&
          row.regionId === criteria.regionId &&
          row.sandboxClass === criteria.sandboxClass &&
          row.source === criteria.source
        ) {
          sourceRows.splice(index, 1)
        }
      }
      return { affected: 1 }
    }),
  }

  const dataSource = {
    transaction: jest.fn(async (callback: (entityManager: any) => Promise<unknown>) => callback(manager)),
  }

  return { dataSource, manager, sourceRows, quotaRows }
}

function createService(options: { enforceQuotas?: boolean; regionExists?: boolean; orgExists?: boolean } = {}) {
  const { dataSource, sourceRows, quotaRows } = createFakeDataSource()
  const regionService = {
    findOne: jest.fn(async () =>
      options.regionExists === false ? null : { id: 'region-1', enforceQuotas: options.enforceQuotas !== false },
    ),
  }
  const organizationService = {
    findOne: jest.fn(async () => (options.orgExists === false ? null : { id: 'org-1' })),
  }
  const service = new RoostQuotasService(
    {} as any,
    {} as any,
    regionService as any,
    organizationService as any,
    dataSource as any,
  )
  return { service, sourceRows, quotaRows, regionService, organizationService }
}

const limits = (cpu: number, memory: number, disk: number, maxCpu: number, maxMemory: number, maxDisk: number) => ({
  cpu,
  memory_gib: memory,
  disk_gib: disk,
  max_cpu_per_sandbox: maxCpu,
  max_memory_per_sandbox: maxMemory,
  max_disk_per_sandbox: maxDisk,
})

describe('aggregateQuotaSources', () => {
  it('sums totals and maxes per-sandbox limits across sources', () => {
    const aggregate = aggregateQuotaSources([
      {
        totalCpuQuota: 4,
        totalMemoryQuota: 8,
        totalDiskQuota: 20,
        maxCpuPerSandbox: 2,
        maxMemoryPerSandbox: 4,
        maxDiskPerSandbox: 20,
      },
      {
        totalCpuQuota: 8,
        totalMemoryQuota: 16,
        totalDiskQuota: 40,
        maxCpuPerSandbox: 8,
        maxMemoryPerSandbox: 12,
        maxDiskPerSandbox: 10,
      },
    ])

    expect(aggregate).toEqual({
      totalCpuQuota: 12,
      totalMemoryQuota: 24,
      totalDiskQuota: 60,
      maxCpuPerSandbox: 8,
      maxMemoryPerSandbox: 12,
      maxDiskPerSandbox: 20,
    })
  })

  it('returns null when there is no source left', () => {
    expect(aggregateQuotaSources([])).toBeNull()
  })

  it('keeps null per-sandbox limits when no source declares them', () => {
    const aggregate = aggregateQuotaSources([
      { totalCpuQuota: 1, totalMemoryQuota: 1, totalDiskQuota: 1, maxCpuPerSandbox: null, maxMemoryPerSandbox: null, maxDiskPerSandbox: null },
    ])
    expect(aggregate?.totalCpuQuota).toBe(1)
    expect(aggregate?.maxCpuPerSandbox).toBeNull()
  })
})

describe('normalizePutRegionQuotaBody', () => {
  it('normalizes the contract body', () => {
    const normalized = normalizePutRegionQuotaBody({
      source: 'lease:lease-1',
      sandbox_class: 'container',
      limits: limits(4, 8, 20, 2, 4, 8),
    })

    expect(normalized).toEqual({
      source: 'lease:lease-1',
      sandboxClass: SandboxClass.CONTAINER,
      totalCpuQuota: 4,
      totalMemoryQuota: 8,
      totalDiskQuota: 20,
      maxCpuPerSandbox: 2,
      maxMemoryPerSandbox: 4,
      maxDiskPerSandbox: 8,
    })
  })

  it('rejects missing limits and negative values', () => {
    expect(() => normalizePutRegionQuotaBody({ source: 'lease:1' })).toThrow(BadRequestException)
    expect(() =>
      normalizePutRegionQuotaBody({ source: 'lease:1', limits: limits(-1, 8, 20, 2, 4, 8) }),
    ).toThrow(BadRequestException)
  })
})

describe('normalizeSandboxClass', () => {
  it('defaults to container and rejects unknown classes', () => {
    expect(normalizeSandboxClass(undefined)).toBe(SandboxClass.CONTAINER)
    expect(() => normalizeSandboxClass('quantum')).toThrow(BadRequestException)
  })
})

describe('RoostQuotasService', () => {
  it('materializes the aggregate region_quota from multiple lease sources', async () => {
    const { service, quotaRows } = createService()

    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-1',
      sandbox_class: 'container',
      limits: limits(4, 8, 20, 2, 4, 8),
    })
    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-2',
      sandbox_class: 'container',
      limits: limits(8, 16, 40, 4, 8, 12),
    })

    expect(quotaRows).toHaveLength(1)
    expect(quotaRows[0]).toMatchObject({
      organizationId: 'org-1',
      regionId: 'region-1',
      totalCpuQuota: 12,
      totalMemoryQuota: 24,
      totalDiskQuota: 60,
      maxCpuPerSandbox: 4,
      maxMemoryPerSandbox: 8,
      maxDiskPerSandbox: 12,
    })
  })

  it('is idempotent per source (same source replaces its contribution)', async () => {
    const { service, sourceRows, quotaRows } = createService()

    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-1',
      sandbox_class: 'container',
      limits: limits(4, 8, 20, 2, 4, 8),
    })
    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-1',
      sandbox_class: 'container',
      limits: limits(6, 12, 24, 3, 6, 9),
    })

    expect(sourceRows).toHaveLength(1)
    expect(quotaRows[0]).toMatchObject({
      totalCpuQuota: 6,
      totalMemoryQuota: 12,
      totalDiskQuota: 24,
      maxCpuPerSandbox: 3,
    })
  })

  it('removes one source and deletes region_quota when no source is left', async () => {
    const { service, sourceRows, quotaRows } = createService()
    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-1',
      limits: limits(4, 8, 20, 2, 4, 8),
    })
    await service.putQuota('org-1', 'region-1', {
      source: 'lease:lease-2',
      limits: limits(4, 8, 20, 4, 8, 8),
    })

    await service.deleteQuota('org-1', 'region-1', 'lease:lease-1', 'container')
    expect(sourceRows).toHaveLength(1)
    expect(quotaRows[0]).toMatchObject({ totalCpuQuota: 4, maxCpuPerSandbox: 4 })

    await service.deleteQuota('org-1', 'region-1', 'lease:lease-2', 'container')
    expect(sourceRows).toHaveLength(0)
    expect(quotaRows).toHaveLength(0)
  })

  it('is idempotent when deleting an unknown source', async () => {
    const { service } = createService()
    await expect(service.deleteQuota('org-1', 'region-1', 'lease:none', 'container')).resolves.toBeUndefined()
  })

  it('rejects regions that do not enforce quotas', async () => {
    const { service } = createService({ enforceQuotas: false })
    await expect(
      service.putQuota('org-1', 'region-1', { source: 'lease:1', limits: limits(1, 1, 1, 1, 1, 1) }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects unknown organizations and regions', async () => {
    await expect(
      createService({ orgExists: false }).service.putQuota('org-x', 'region-1', {
        source: 'lease:1',
        limits: limits(1, 1, 1, 1, 1, 1),
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      createService({ regionExists: false }).service.putQuota('org-1', 'region-x', {
        source: 'lease:1',
        limits: limits(1, 1, 1, 1, 1, 1),
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
