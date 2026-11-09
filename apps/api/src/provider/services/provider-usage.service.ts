/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindOptionsWhere, IsNull, LessThan, MoreThan, Repository } from 'typeorm'
import { RunnerService } from '../../sandbox/services/runner.service'
import { SandboxUsagePeriodArchive } from '../../usage/entities/sandbox-usage-period-archive.entity'
import { SandboxUsagePeriod } from '../../usage/entities/sandbox-usage-period.entity'
import {
  ProviderUsageGranularity,
  ProviderUsageItemDto,
  ProviderUsageResponseDto,
  ProviderUsageTotalsDto,
} from '../dto/provider-usage.dto'
import { DAY_MS, ResolvedDateRange, resolveDateRange, round } from '../utils/date-range.util'

export const DEFAULT_PROVIDER_CURRENCY = 'CNY'

interface UsageBucket {
  date: string | null
  runnerId: string | null
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
  sandboxIds: Set<string>
}

@Injectable()
export class ProviderUsageService {
  constructor(
    @InjectRepository(SandboxUsagePeriod)
    private readonly usagePeriodRepository: Repository<SandboxUsagePeriod>,
    @InjectRepository(SandboxUsagePeriodArchive)
    private readonly usagePeriodArchiveRepository: Repository<SandboxUsagePeriodArchive>,
    private readonly runnerService: RunnerService,
  ) {}

  /**
   * Aggregates billable usage (vCPU · h, GiB · h) per compute node and optional UTC day.
   */
  async getUsage(
    organizationId: string,
    options: {
      from?: string
      to?: string
      granularity?: ProviderUsageGranularity
      runnerId?: string
    } = {},
  ): Promise<ProviderUsageResponseDto> {
    const granularity = options.granularity ?? 'day'
    const range = resolveDateRange(options.from, options.to)

    if (range.from.getTime() >= range.to.getTime()) {
      throw new BadRequestException('Invalid date range: "from" must be before "to"')
    }

    const [currentPeriods, archivedPeriods] = await Promise.all([
      this.fetchPeriods(this.usagePeriodRepository, organizationId, range, options.runnerId),
      this.fetchPeriods(this.usagePeriodArchiveRepository, organizationId, range, options.runnerId),
    ])

    const buckets = new Map<string, UsageBucket>()
    const allSandboxIds = new Set<string>()
    const runnerIds = new Set<string>()
    const now = Date.now()

    const accumulate = (period: SandboxUsagePeriod | SandboxUsagePeriodArchive) => {
      const startMs = Math.max(period.startAt.getTime(), range.from.getTime())
      const endMs = Math.min((period.endAt ?? new Date(now)).getTime(), range.to.getTime())

      if (endMs <= startMs) {
        return
      }

      const runnerId = period.runnerId ?? null
      if (runnerId) {
        runnerIds.add(runnerId)
      }
      allSandboxIds.add(period.sandboxId)

      let cursor = startMs
      while (cursor < endMs) {
        const dayStartMs = Math.floor(cursor / DAY_MS) * DAY_MS
        const segmentEndMs = Math.min(endMs, dayStartMs + DAY_MS)
        const hours = (segmentEndMs - cursor) / (60 * 60 * 1000)
        const date = granularity === 'day' ? new Date(dayStartMs).toISOString().slice(0, 10) : null
        const bucketKey = `${date ?? 'total'}|${runnerId ?? 'unassigned'}`

        let bucket = buckets.get(bucketKey)
        if (!bucket) {
          bucket = {
            date,
            runnerId,
            cpuHours: 0,
            memoryGiBHours: 0,
            diskGiBHours: 0,
            gpuHours: 0,
            sandboxIds: new Set<string>(),
          }
          buckets.set(bucketKey, bucket)
        }

        bucket.cpuHours += period.cpu * hours
        bucket.memoryGiBHours += period.mem * hours
        bucket.diskGiBHours += period.disk * hours
        bucket.gpuHours += (period.gpu ?? 0) * hours
        bucket.sandboxIds.add(period.sandboxId)

        cursor = segmentEndMs
      }
    }

    for (const period of currentPeriods) {
      accumulate(period)
    }
    for (const period of archivedPeriods) {
      accumulate(period)
    }

    const runnerNameMap = await this.resolveRunnerNames(runnerIds)

    const items: ProviderUsageItemDto[] = Array.from(buckets.values())
      .map((bucket) => ({
        date: bucket.date,
        runnerId: bucket.runnerId,
        runnerName: bucket.runnerId ? (runnerNameMap.get(bucket.runnerId) ?? '') : '',
        cpuHours: round(bucket.cpuHours),
        memoryGiBHours: round(bucket.memoryGiBHours),
        diskGiBHours: round(bucket.diskGiBHours),
        gpuHours: round(bucket.gpuHours),
        sandboxCount: bucket.sandboxIds.size,
      }))
      .sort((a, b) => {
        const dateCompare = (b.date ?? '').localeCompare(a.date ?? '')
        if (dateCompare !== 0) {
          return dateCompare
        }
        const nameCompare = a.runnerName.localeCompare(b.runnerName)
        if (nameCompare !== 0) {
          return nameCompare
        }
        return (a.runnerId ?? '').localeCompare(b.runnerId ?? '')
      })

    const totals = items.reduce<ProviderUsageTotalsDto>(
      (acc, item) => {
        acc.cpuHours += item.cpuHours
        acc.memoryGiBHours += item.memoryGiBHours
        acc.diskGiBHours += item.diskGiBHours
        acc.gpuHours += item.gpuHours
        return acc
      },
      {
        cpuHours: 0,
        memoryGiBHours: 0,
        diskGiBHours: 0,
        gpuHours: 0,
        sandboxCount: allSandboxIds.size,
      },
    )

    totals.cpuHours = round(totals.cpuHours)
    totals.memoryGiBHours = round(totals.memoryGiBHours)
    totals.diskGiBHours = round(totals.diskGiBHours)
    totals.gpuHours = round(totals.gpuHours)

    return {
      from: range.fromLabel,
      to: range.toLabel,
      currency: DEFAULT_PROVIDER_CURRENCY,
      items,
      totals,
    }
  }

  /**
   * Per-sandbox usage breakdown of a single node over the requested range. Used by the
   * settlement engine to persist per-sandbox settlement lines.
   */
  async getSandboxUsage(
    organizationId: string,
    options: {
      from?: string
      to?: string
      runnerId: string
    },
  ): Promise<
    Array<{
      sandboxId: string
      cpuHours: number
      memoryGiBHours: number
      diskGiBHours: number
      gpuHours: number
    }>
  > {
    if (!options.runnerId) {
      throw new BadRequestException('"runnerId" is required')
    }

    const range = resolveDateRange(options.from, options.to)
    const [currentPeriods, archivedPeriods] = await Promise.all([
      this.fetchPeriods(this.usagePeriodRepository, organizationId, range, options.runnerId),
      this.fetchPeriods(this.usagePeriodArchiveRepository, organizationId, range, options.runnerId),
    ])

    const now = Date.now()
    const buckets = new Map<
      string,
      {
        cpuHours: number
        memoryGiBHours: number
        diskGiBHours: number
        gpuHours: number
      }
    >()

    const accumulate = (period: SandboxUsagePeriod | SandboxUsagePeriodArchive) => {
      const startMs = Math.max(period.startAt.getTime(), range.from.getTime())
      const endMs = Math.min((period.endAt ?? new Date(now)).getTime(), range.to.getTime())

      if (endMs <= startMs) {
        return
      }

      const hours = (endMs - startMs) / (60 * 60 * 1000)

      let bucket = buckets.get(period.sandboxId)
      if (!bucket) {
        bucket = { cpuHours: 0, memoryGiBHours: 0, diskGiBHours: 0, gpuHours: 0 }
        buckets.set(period.sandboxId, bucket)
      }

      bucket.cpuHours += period.cpu * hours
      bucket.memoryGiBHours += period.mem * hours
      bucket.diskGiBHours += period.disk * hours
      bucket.gpuHours += (period.gpu ?? 0) * hours
    }

    for (const period of currentPeriods) {
      accumulate(period)
    }
    for (const period of archivedPeriods) {
      accumulate(period)
    }

    return Array.from(buckets.entries()).map(([sandboxId, bucket]) => ({
      sandboxId,
      cpuHours: round(bucket.cpuHours),
      memoryGiBHours: round(bucket.memoryGiBHours),
      diskGiBHours: round(bucket.diskGiBHours),
      gpuHours: round(bucket.gpuHours),
    }))
  }

  private async fetchPeriods<T extends SandboxUsagePeriod | SandboxUsagePeriodArchive>(
    repository: Pick<Repository<T>, 'find'>,
    organizationId: string,
    range: ResolvedDateRange,
    runnerId?: string,
  ): Promise<T[]> {
    const baseWhere = {
      organizationId,
      startAt: LessThan(range.to),
      ...(runnerId ? { runnerId } : {}),
    } as FindOptionsWhere<T>

    // Open periods always overlap the requested range; closed ones must end after the range
    // starts. Splitting the query keeps the where clause simple and index friendly.
    const [openPeriods, closedPeriods] = await Promise.all([
      repository.find({ where: { ...baseWhere, endAt: IsNull() } as FindOptionsWhere<T> }),
      repository.find({ where: { ...baseWhere, endAt: MoreThan(range.from) } as FindOptionsWhere<T> }),
    ])

    return [...openPeriods, ...closedPeriods]
  }

  private async resolveRunnerNames(runnerIds: Set<string>): Promise<Map<string, string>> {
    if (runnerIds.size === 0) {
      return new Map()
    }

    const runners = await this.runnerService.findByIds(Array.from(runnerIds))
    return new Map(runners.map((runner) => [runner.id, runner.name]))
  }
}
