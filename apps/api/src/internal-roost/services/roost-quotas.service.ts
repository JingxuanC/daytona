/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { OrganizationService } from '../../organization/services/organization.service'
import { RegionQuota } from '../../organization/entities/region-quota.entity'
import { SandboxClass } from '../../sandbox/enums/sandbox-class.enum'
import { RegionService } from '../../region/services/region.service'
import { PutRegionQuotaBody } from '../dto/internal-roost.dto'
import { RegionQuotaSource } from '../entities/region-quota-source.entity'

export interface NormalizedRegionQuotaRequest {
  source: string
  sandboxClass: SandboxClass
  totalCpuQuota: number
  totalMemoryQuota: number
  totalDiskQuota: number
  maxCpuPerSandbox: number | null
  maxMemoryPerSandbox: number | null
  maxDiskPerSandbox: number | null
}

export interface AggregatedRegionQuota {
  totalCpuQuota: number
  totalMemoryQuota: number
  totalDiskQuota: number
  maxCpuPerSandbox: number | null
  maxMemoryPerSandbox: number | null
  maxDiskPerSandbox: number | null
}

/**
 * Aggregates per-source quota contributions into the single `region_quota` row that
 * the existing sandbox quota enforcement reads:
 *
 * - totals (cpu/memory/disk): sum over all sources
 * - per-sandbox limits: max over all sources
 *
 * Exported as a pure function so the aggregation semantics are unit tested directly.
 */
export function aggregateQuotaSources(
  sources: Array<Pick<RegionQuotaSource, keyof AggregatedRegionQuota>>,
): AggregatedRegionQuota | null {
  if (sources.length === 0) {
    return null
  }

  return {
    totalCpuQuota: sources.reduce((sum, source) => sum + (source.totalCpuQuota ?? 0), 0),
    totalMemoryQuota: sources.reduce((sum, source) => sum + (source.totalMemoryQuota ?? 0), 0),
    totalDiskQuota: sources.reduce((sum, source) => sum + (source.totalDiskQuota ?? 0), 0),
    maxCpuPerSandbox: maxOrNull(sources.map((source) => source.maxCpuPerSandbox)),
    maxMemoryPerSandbox: maxOrNull(sources.map((source) => source.maxMemoryPerSandbox)),
    maxDiskPerSandbox: maxOrNull(sources.map((source) => source.maxDiskPerSandbox)),
  }
}

function maxOrNull(values: Array<number | null | undefined>): number | null {
  const defined = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return defined.length === 0 ? null : Math.max(...defined)
}

/**
 * Per-source, idempotent region quota management.
 *
 * PUT replaces the contribution of one `source` (e.g. `lease:<lease_id>`) and
 * re-materializes the aggregate into `region_quota`.
 * DELETE removes one source contribution; when the last source is removed the
 * materialized `region_quota` row is deleted too, which makes the region invisible to
 * the organization again (compute-market visibility rule).
 */
@Injectable()
export class RoostQuotasService {
  private readonly logger = new Logger(RoostQuotasService.name)

  constructor(
    @InjectRepository(RegionQuotaSource)
    private readonly quotaSourceRepository: Repository<RegionQuotaSource>,
    @InjectRepository(RegionQuota)
    private readonly regionQuotaRepository: Repository<RegionQuota>,
    private readonly regionService: RegionService,
    private readonly organizationService: OrganizationService,
    private readonly dataSource: DataSource,
  ) {}

  async putQuota(orgId: string, regionId: string, body: PutRegionQuotaBody): Promise<void> {
    const request = normalizePutRegionQuotaBody(body)
    await this.assertQuotaTarget(orgId, regionId)

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RegionQuotaSource)
      const existing = await repository.findOne({
        where: {
          organizationId: orgId,
          regionId,
          sandboxClass: request.sandboxClass,
          source: request.source,
        },
      })

      if (existing) {
        existing.totalCpuQuota = request.totalCpuQuota
        existing.totalMemoryQuota = request.totalMemoryQuota
        existing.totalDiskQuota = request.totalDiskQuota
        existing.maxCpuPerSandbox = request.maxCpuPerSandbox
        existing.maxMemoryPerSandbox = request.maxMemoryPerSandbox
        existing.maxDiskPerSandbox = request.maxDiskPerSandbox
        await repository.save(existing)
      } else {
        const created = new RegionQuotaSource()
        created.organizationId = orgId
        created.regionId = regionId
        created.sandboxClass = request.sandboxClass
        created.source = request.source
        created.totalCpuQuota = request.totalCpuQuota
        created.totalMemoryQuota = request.totalMemoryQuota
        created.totalDiskQuota = request.totalDiskQuota
        created.maxCpuPerSandbox = request.maxCpuPerSandbox
        created.maxMemoryPerSandbox = request.maxMemoryPerSandbox
        created.maxDiskPerSandbox = request.maxDiskPerSandbox
        await repository.save(created)
      }

      await this.materialize(manager, orgId, regionId, request.sandboxClass)
    })

    this.logger.log(
      `Upserted region quota source ${request.source} for organization ${orgId} region ${regionId} (${request.sandboxClass})`,
    )
  }

  async deleteQuota(orgId: string, regionId: string, sourceRaw: string, sandboxClassRaw?: string): Promise<void> {
    const source = normalizeRequiredString(sourceRaw, 'source')
    const sandboxClass = normalizeSandboxClass(sandboxClassRaw)

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RegionQuotaSource, {
        organizationId: orgId,
        regionId,
        sandboxClass,
        source,
      })
      await this.materialize(manager, orgId, regionId, sandboxClass)
    })

    this.logger.log(
      `Deleted region quota source ${source} for organization ${orgId} region ${regionId} (${sandboxClass})`,
    )
  }

  private async materialize(
    manager: import('typeorm').EntityManager,
    orgId: string,
    regionId: string,
    sandboxClass: SandboxClass,
  ): Promise<void> {
    const sources = await manager.getRepository(RegionQuotaSource).find({
      where: { organizationId: orgId, regionId, sandboxClass },
    })
    const aggregate = aggregateQuotaSources(sources)

    const regionQuotaRepository = manager.getRepository(RegionQuota)
    const existing = await regionQuotaRepository.findOne({
      where: { organizationId: orgId, regionId, sandboxClass },
    })

    if (!aggregate) {
      if (existing) {
        await regionQuotaRepository.remove(existing)
      }
      return
    }

    const regionQuota = existing ?? new RegionQuota({
      organizationId: orgId,
      regionId,
      sandboxClass,
      totalCpuQuota: aggregate.totalCpuQuota,
      totalMemoryQuota: aggregate.totalMemoryQuota,
      totalDiskQuota: aggregate.totalDiskQuota,
    })

    regionQuota.totalCpuQuota = aggregate.totalCpuQuota
    regionQuota.totalMemoryQuota = aggregate.totalMemoryQuota
    regionQuota.totalDiskQuota = aggregate.totalDiskQuota
    regionQuota.maxCpuPerSandbox = aggregate.maxCpuPerSandbox
    regionQuota.maxMemoryPerSandbox = aggregate.maxMemoryPerSandbox
    regionQuota.maxDiskPerSandbox = aggregate.maxDiskPerSandbox

    await regionQuotaRepository.save(regionQuota)
  }

  private async assertQuotaTarget(orgId: string, regionId: string): Promise<void> {
    const organization = await this.organizationService.findOne(orgId)
    if (!organization) {
      throw new NotFoundException(`Organization ${orgId} not found`)
    }

    const region = await this.regionService.findOne(regionId)
    if (!region) {
      throw new NotFoundException(`Region ${regionId} not found`)
    }
    if (!region.enforceQuotas) {
      throw new BadRequestException(`Region ${regionId} does not enforce quotas`)
    }
  }
}

export function normalizePutRegionQuotaBody(body: PutRegionQuotaBody): NormalizedRegionQuotaRequest {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const source = normalizeRequiredString(body.source, 'source')
  const sandboxClass = normalizeSandboxClass(body.sandbox_class ?? body.sandboxClass)

  const limits = body.limits
  if (!limits || typeof limits !== 'object') {
    throw new BadRequestException('limits is required')
  }

  return {
    source,
    sandboxClass,
    totalCpuQuota: normalizeNonNegativeInteger(limits.cpu, 'limits.cpu'),
    totalMemoryQuota: normalizeNonNegativeInteger(limits.memory_gib ?? limits.memoryGiB, 'limits.memory_gib'),
    totalDiskQuota: normalizeNonNegativeInteger(limits.disk_gib ?? limits.diskGiB, 'limits.disk_gib'),
    maxCpuPerSandbox: normalizeNonNegativeInteger(
      limits.max_cpu_per_sandbox ?? limits.maxCpuPerSandbox,
      'limits.max_cpu_per_sandbox',
    ),
    maxMemoryPerSandbox: normalizeNonNegativeInteger(
      limits.max_memory_per_sandbox ?? limits.maxMemoryPerSandbox,
      'limits.max_memory_per_sandbox',
    ),
    maxDiskPerSandbox: normalizeNonNegativeInteger(
      limits.max_disk_per_sandbox ?? limits.maxDiskPerSandbox,
      'limits.max_disk_per_sandbox',
    ),
  }
}

export function normalizeSandboxClass(value: unknown): SandboxClass {
  const values = Object.values(SandboxClass)
  if (value === undefined || value === null || value === '') {
    return SandboxClass.CONTAINER
  }
  if (typeof value !== 'string' || !values.includes(value as SandboxClass)) {
    throw new BadRequestException(`sandbox_class must be one of: ${values.join(', ')}`)
  }
  return value as SandboxClass
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > 255) {
    throw new BadRequestException(`${field} must be at most 255 characters`)
  }
  return trimmed
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
  if (value === undefined || value === null) {
    throw new BadRequestException(`${field} is required`)
  }
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer`)
  }
  return numeric
}
