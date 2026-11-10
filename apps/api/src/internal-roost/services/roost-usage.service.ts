/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { SandboxUsagePeriod } from '../../usage/entities/sandbox-usage-period.entity'
import { UsagePage, UsageSample } from '../dto/internal-roost.dto'

const MIB_PER_GIB = 1024

interface UsageAccumulator {
  sandboxId: string
  periodStartMs: number
  periodEndMs: number
  cpuSeconds: number
  memoryMibSeconds: number
  diskMibSeconds: number
  gpuSeconds: number
}

/**
 * Reads integer-second usage from `sandbox_usage_periods`.
 *
 * The market service converts these numbers into money with its own lease price
 * snapshot; this endpoint never returns or writes amounts.
 *
 * Per period sample:
 * - `cpu_seconds` = allocated vCPU × seconds
 * - `memory_mib_seconds` = allocated GiB × 1024 × seconds
 * - `disk_mib_seconds` = allocated GiB × 1024 × seconds
 * - `gpu_seconds` = allocated GPU × seconds
 *
 * `group_by=sandbox` merges all periods of a sandbox inside the requested window.
 */
@Injectable()
export class RoostUsageService {
  constructor(
    @InjectRepository(SandboxUsagePeriod)
    private readonly usagePeriodRepository: Repository<SandboxUsagePeriod>,
  ) {}

  async getUsage(orgId: string, fromRaw: string, toRaw: string, groupBy?: string): Promise<UsagePage> {
    const { from, to } = parseUsageWindow(fromRaw, toRaw)
    if (groupBy !== undefined && groupBy !== 'sandbox') {
      throw new BadRequestException('group_by must be "sandbox" when provided')
    }

    const periods = await this.usagePeriodRepository
      .createQueryBuilder('period')
      .where('period.organizationId = :orgId', { orgId })
      .andWhere('period.startAt < :to', { to })
      .andWhere('(period.endAt IS NULL OR period.endAt > :from)', { from })
      .orderBy('period.startAt', 'ASC')
      .getMany()

    const nowMs = Date.now()
    const samples: UsageSample[] = []

    for (const period of periods) {
      const periodStartMs = Math.max(period.startAt.getTime(), from.getTime())
      const periodEndMs = Math.min(period.endAt ? period.endAt.getTime() : nowMs, to.getTime())
      if (periodEndMs <= periodStartMs) {
        continue
      }

      const seconds = Math.floor((periodEndMs - periodStartMs) / 1000)
      if (seconds <= 0) {
        continue
      }

      samples.push(
        toUsageSample({
          sandboxId: period.sandboxId,
          periodStartMs,
          periodEndMs,
          seconds,
          cpu: period.cpu,
          memoryGiB: period.mem,
          diskGiB: period.disk,
          gpu: period.gpu,
        }),
      )
    }

    if (groupBy === 'sandbox') {
      return { items: groupSamplesBySandbox(samples) }
    }

    return { items: samples }
  }
}

function toUsageSample(params: {
  sandboxId: string
  periodStartMs: number
  periodEndMs: number
  seconds: number
  cpu: number
  memoryGiB: number
  diskGiB: number
  gpu: number
}): UsageSample {
  return {
    sandbox_id: params.sandboxId,
    period_start: new Date(params.periodStartMs).toISOString(),
    period_end: new Date(params.periodEndMs).toISOString(),
    cpu_seconds: Math.round(params.cpu * params.seconds),
    memory_mib_seconds: Math.round(params.memoryGiB * MIB_PER_GIB * params.seconds),
    disk_mib_seconds: Math.round(params.diskGiB * MIB_PER_GIB * params.seconds),
    gpu_seconds: Math.round(params.gpu * params.seconds),
  }
}

function groupSamplesBySandbox(samples: UsageSample[]): UsageSample[] {
  const grouped = new Map<string, UsageAccumulator>()

  for (const sample of samples) {
    const sandboxId = sample.sandbox_id as string
    const startMs = Date.parse(sample.period_start)
    const endMs = Date.parse(sample.period_end)
    const current = grouped.get(sandboxId)
    if (!current) {
      grouped.set(sandboxId, {
        sandboxId,
        periodStartMs: startMs,
        periodEndMs: endMs,
        cpuSeconds: sample.cpu_seconds,
        memoryMibSeconds: sample.memory_mib_seconds,
        diskMibSeconds: sample.disk_mib_seconds,
        gpuSeconds: sample.gpu_seconds,
      })
      continue
    }

    current.periodStartMs = Math.min(current.periodStartMs, startMs)
    current.periodEndMs = Math.max(current.periodEndMs, endMs)
    current.cpuSeconds += sample.cpu_seconds
    current.memoryMibSeconds += sample.memory_mib_seconds
    current.diskMibSeconds += sample.disk_mib_seconds
    current.gpuSeconds += sample.gpu_seconds
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.sandboxId.localeCompare(right.sandboxId))
    .map((entry) => ({
      sandbox_id: entry.sandboxId,
      period_start: new Date(entry.periodStartMs).toISOString(),
      period_end: new Date(entry.periodEndMs).toISOString(),
      cpu_seconds: entry.cpuSeconds,
      memory_mib_seconds: entry.memoryMibSeconds,
      disk_mib_seconds: entry.diskMibSeconds,
      gpu_seconds: entry.gpuSeconds,
    }))
}

/** Accepts ISO-8601 date-times (contract) and, for convenience, unix seconds. */
export function parseUsageWindow(fromRaw: string, toRaw: string): { from: Date; to: Date } {
  const from = parseDateOrUnixSeconds(fromRaw, 'from')
  const to = parseDateOrUnixSeconds(toRaw, 'to')

  if (Number.isNaN(from.getTime())) {
    throw new BadRequestException('from must be an ISO-8601 date-time')
  }
  if (Number.isNaN(to.getTime())) {
    throw new BadRequestException('to must be an ISO-8601 date-time')
  }
  if (from.getTime() >= to.getTime()) {
    throw new BadRequestException('from must be before to')
  }

  return { from, to }
}

function parseDateOrUnixSeconds(raw: string | undefined, field: string): Date {
  if (raw === undefined || raw === null || `${raw}`.trim().length === 0) {
    throw new BadRequestException(`${field} is required`)
  }
  const value = `${raw}`.trim()
  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000)
  }
  const parsed = Date.parse(value)
  return new Date(Number.isNaN(parsed) ? NaN : parsed)
}
