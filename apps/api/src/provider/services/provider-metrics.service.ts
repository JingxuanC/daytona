/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import * as net from 'net'
import { In, Repository } from 'typeorm'
import { RegionService } from '../../region/services/region.service'
import { RegionType } from '../../region/enums/region-type.enum'
import { SandboxEvents } from '../../sandbox/constants/sandbox-events.constants'
import { Runner } from '../../sandbox/entities/runner.entity'
import { SandboxDesiredState } from '../../sandbox/enums/sandbox-desired-state.enum'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { RunnerState } from '../../sandbox/enums/runner-state.enum'
import { SandboxStateUpdatedEvent } from '../../sandbox/events/sandbox-state-updated.event'
import { ProviderNodeMetrics } from '../dto/provider-node.dto'
import { RunnerAlertSeverity, RunnerAlertType } from '../entities/runner-alert.entity'
import { RunnerDailyMetric } from '../entities/runner-daily-metric.entity'
import { DAY_MS, formatUtcDay } from '../utils/date-range.util'
import { ProviderAlertsService } from './provider-alerts.service'

const PROBE_TIMEOUT_MS = 3000
const PROBE_BATCH_SIZE = 100
const OFFLINE_THRESHOLD_MS = 60 * 1000
const HIGH_LATENCY_THRESHOLD_MS = 1000
const RESOURCE_PRESSURE_THRESHOLD_PCT = 95
const HEALTH_FAILURE_THRESHOLD = 3
/**
 * 新建节点在拿到第一次心跳前处于 INITIALIZING。宽限期内不报警（避免启动噪音），
 * 超过宽限期仍未上线则按 OFFLINE 处理。默认 5 分钟，可用
 * PROVIDER_NODE_INITIALIZING_GRACE_SECONDS 覆盖（验收时调小）。
 */
const DEFAULT_INITIALIZING_GRACE_MS = 5 * 60 * 1000
/** Only starts of sandboxes created within this window are used as startup duration samples. */
const FRESH_START_WINDOW_MS = 30 * 60 * 1000
const METRICS_WINDOW_DAYS = 7

interface ProviderRunner {
  organizationId: string
  runner: Runner
}

function initializingGraceMs(): number {
  const raw = process.env.PROVIDER_NODE_INITIALIZING_GRACE_SECONDS
  if (raw === undefined || raw.trim() === '') return DEFAULT_INITIALIZING_GRACE_MS
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_INITIALIZING_GRACE_MS
}

interface DailyMetricRow {
  runnerId: string
  starts: string
  failures: string
  startupSeconds: string
}

@Injectable()
export class ProviderMetricsService {
  private readonly logger = new Logger(ProviderMetricsService.name)

  constructor(
    @InjectRepository(RunnerDailyMetric)
    private readonly metricRepository: Repository<RunnerDailyMetric>,
    @InjectRepository(Runner)
    private readonly runnerRepository: Repository<Runner>,
    private readonly regionService: RegionService,
    private readonly alertsService: ProviderAlertsService,
  ) {}

  /**
   * Aggregated 7 day metrics for the given nodes.
   */
  async getMetricsForRunners(runnerIds: string[]): Promise<Map<string, ProviderNodeMetrics>> {
    const result = new Map<string, ProviderNodeMetrics>()

    if (runnerIds.length === 0) {
      return result
    }

    const since = formatUtcDay(new Date(Date.now() - (METRICS_WINDOW_DAYS - 1) * DAY_MS))

    const [metricRows, alertCounts, runners] = await Promise.all([
      this.metricRepository
        .createQueryBuilder('metric')
        .select('metric.runnerId', 'runnerId')
        .addSelect('SUM(metric.sandboxStarts)', 'starts')
        .addSelect('SUM(metric.sandboxStartFailures)', 'failures')
        .addSelect('SUM(metric.totalStartupSeconds)', 'startupSeconds')
        .where('metric.runnerId IN (:...runnerIds)', { runnerIds })
        .andWhere('metric.date >= :since', { since })
        .groupBy('metric.runnerId')
        .getRawMany<DailyMetricRow>(),
      this.alertsService.getOpenAlertCounts(runnerIds),
      this.runnerRepository.find({ where: { id: In(runnerIds) } }),
    ])

    const metricMap = new Map(metricRows.map((row) => [row.runnerId, row]))

    for (const runnerId of runnerIds) {
      const row = metricMap.get(runnerId)
      const starts = row ? Number(row.starts) : 0
      const failures = row ? Number(row.failures) : 0
      const startupSeconds = row ? Number(row.startupSeconds) : 0
      const runner = runners.find((candidate) => candidate.id === runnerId)

      result.set(runnerId, {
        rttMs: runner?.lastRttMs ?? null,
        sandboxStarts7d: starts,
        sandboxStartFailures7d: failures,
        avgStartupSeconds7d: starts > 0 ? Math.round((startupSeconds / starts) * 100) / 100 : null,
        openAlertCount: alertCounts.get(runnerId) ?? 0,
      })
    }

    return result
  }

  /**
   * Probes every provider node and stores the TCP round trip time. A failed probe
   * increments the consecutive failure counter, a successful one resets it.
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'provider-node-rtt-probe' })
  async probeProviderNodes(): Promise<void> {
    try {
      const providerRunners = await this.getProviderRunners()
      const targets = providerRunners.filter(({ runner }) => this.parseProbeTarget(runner)).slice(0, PROBE_BATCH_SIZE)

      await Promise.all(
        targets.map(async ({ runner }) => {
          const target = this.parseProbeTarget(runner)
          if (!target) {
            return
          }

          const rttMs = await this.probeTcp(target.host, target.port)

          if (rttMs === null) {
            await this.runnerRepository.increment({ id: runner.id }, 'consecutiveHealthFailures', 1)
            return
          }

          await this.runnerRepository.update(
            { id: runner.id },
            {
              lastRttMs: rttMs,
              lastRttAt: new Date(),
              consecutiveHealthFailures: 0,
            },
          )
        }),
      )
    } catch (error) {
      this.logger.error('Error probing provider nodes', error)
    }
  }

  /**
   * Derives node alerts from the latest reported state and resolves them automatically
   * once the node recovers.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'provider-node-alert-scan' })
  async scanProviderNodeAlerts(): Promise<void> {
    try {
      const providerRunners = await this.getProviderRunners()
      const now = Date.now()

      const graceMs = initializingGraceMs()

      for (const { organizationId, runner } of providerRunners) {
        // 刚创建、还在启动的节点给一段宽限期；超过宽限期仍是 INITIALIZING 说明
        // 节点从未上线，必须按 OFFLINE 报警，否则“永远连不上”的节点完全不可见。
        if (runner.state === RunnerState.INITIALIZING) {
          const createdAtMs = runner.createdAt ? runner.createdAt.getTime() : null
          const ageMs = createdAtMs === null ? Number.POSITIVE_INFINITY : now - createdAtMs
          if (ageMs < graceMs) {
            continue
          }
        }

        const lastCheckedMs = runner.lastChecked ? runner.lastChecked.getTime() : null
        const offline = lastCheckedMs === null || now - lastCheckedMs > OFFLINE_THRESHOLD_MS
        const healthcheckFailed = runner.consecutiveHealthFailures >= HEALTH_FAILURE_THRESHOLD
        const highLatency = runner.lastRttMs !== null && runner.lastRttMs > HIGH_LATENCY_THRESHOLD_MS
        const resourcePressure =
          runner.currentCpuUsagePercentage >= RESOURCE_PRESSURE_THRESHOLD_PCT ||
          runner.currentMemoryUsagePercentage >= RESOURCE_PRESSURE_THRESHOLD_PCT

        await this.applyAlert({
          organizationId,
          runner,
          type: RunnerAlertType.OFFLINE,
          active: offline,
          severity: RunnerAlertSeverity.CRITICAL,
          message: `Node ${runner.name} has not reported a heartbeat for more than ${Math.round(OFFLINE_THRESHOLD_MS / 1000)}s`,
          details: { lastCheckedAt: runner.lastChecked?.toISOString() ?? null },
        })

        await this.applyAlert({
          organizationId,
          runner,
          type: RunnerAlertType.HEALTHCHECK_FAILED,
          active: healthcheckFailed,
          severity: RunnerAlertSeverity.CRITICAL,
          message: `Node ${runner.name} failed ${runner.consecutiveHealthFailures} consecutive latency probes`,
          details: { consecutiveHealthFailures: runner.consecutiveHealthFailures },
        })

        await this.applyAlert({
          organizationId,
          runner,
          type: RunnerAlertType.HIGH_LATENCY,
          active: highLatency,
          severity: RunnerAlertSeverity.WARNING,
          message: `Node ${runner.name} round trip time is ${runner.lastRttMs}ms (threshold ${HIGH_LATENCY_THRESHOLD_MS}ms)`,
          details: { rttMs: runner.lastRttMs },
        })

        await this.applyAlert({
          organizationId,
          runner,
          type: RunnerAlertType.RESOURCE_PRESSURE,
          active: resourcePressure,
          severity: RunnerAlertSeverity.WARNING,
          message: `Node ${runner.name} is under resource pressure (cpu ${runner.currentCpuUsagePercentage}%, memory ${runner.currentMemoryUsagePercentage}%)`,
          details: {
            cpuUsagePct: runner.currentCpuUsagePercentage,
            memoryUsagePct: runner.currentMemoryUsagePercentage,
          },
        })
      }
    } catch (error) {
      this.logger.error('Error scanning provider node alerts', error)
    }
  }

  /**
   * Records sandbox start outcomes per node so the success rate and average startup
   * duration can be shown in the provider console.
   */
  @OnEvent(SandboxEvents.STATE_UPDATED)
  async handleSandboxStateUpdated(event: SandboxStateUpdatedEvent): Promise<void> {
    try {
      const { sandbox, oldState, newState } = event

      if (!sandbox.runnerId) {
        return
      }

      const date = formatUtcDay(new Date())

      if (newState === SandboxState.STARTED && oldState !== SandboxState.STARTED) {
        const createdAtMs = sandbox.createdAt ? new Date(sandbox.createdAt).getTime() : null
        const elapsedMs = createdAtMs === null ? null : Date.now() - createdAtMs

        // Only fresh sandboxes give a meaningful startup duration.
        if (elapsedMs === null || elapsedMs < 0 || elapsedMs > FRESH_START_WINDOW_MS) {
          return
        }

        await this.applyDailyMetricDelta({
          organizationId: sandbox.organizationId,
          runnerId: sandbox.runnerId,
          date,
          starts: 1,
          failures: 0,
          startupSeconds: Math.round(elapsedMs) / 1000,
        })
        return
      }

      if (
        (newState === SandboxState.ERROR || newState === SandboxState.BUILD_FAILED) &&
        oldState !== newState &&
        sandbox.desiredState === SandboxDesiredState.STARTED
      ) {
        await this.applyDailyMetricDelta({
          organizationId: sandbox.organizationId,
          runnerId: sandbox.runnerId,
          date,
          starts: 0,
          failures: 1,
          startupSeconds: 0,
        })
      }
    } catch (error) {
      this.logger.error('Error recording sandbox start metrics', error)
    }
  }

  private async applyAlert(params: {
    organizationId: string
    runner: Runner
    type: RunnerAlertType
    active: boolean
    severity: RunnerAlertSeverity
    message: string
    details?: Record<string, unknown>
  }): Promise<void> {
    if (params.active) {
      await this.alertsService.raiseAlert({
        organizationId: params.organizationId,
        runnerId: params.runner.id,
        type: params.type,
        severity: params.severity,
        message: params.message,
        details: params.details,
      })
    } else {
      await this.alertsService.resolveOpenAlerts(params.runner.id, params.type)
    }
  }

  private async applyDailyMetricDelta(params: {
    organizationId: string
    runnerId: string
    date: string
    starts: number
    failures: number
    startupSeconds: number
  }): Promise<void> {
    await this.metricRepository.query(
      `INSERT INTO "runner_daily_metrics"
        ("id", "organizationId", "runnerId", "date", "sandboxStarts", "sandboxStartFailures", "totalStartupSeconds", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT ("runnerId", "date") DO UPDATE SET
          "sandboxStarts" = "runner_daily_metrics"."sandboxStarts" + EXCLUDED."sandboxStarts",
          "sandboxStartFailures" = "runner_daily_metrics"."sandboxStartFailures" + EXCLUDED."sandboxStartFailures",
          "totalStartupSeconds" = "runner_daily_metrics"."totalStartupSeconds" + EXCLUDED."totalStartupSeconds",
          "organizationId" = EXCLUDED."organizationId",
          "updatedAt" = now()`,
      [params.organizationId, params.runnerId, params.date, params.starts, params.failures, params.startupSeconds],
    )
  }

  private async getProviderRunners(): Promise<ProviderRunner[]> {
    const regions = await this.regionService.findAllByRegionType(RegionType.CUSTOM)
    const regionOrganizationMap = new Map(
      regions
        .filter((region) => region.organizationId)
        .map((region) => [region.id, region.organizationId as string]),
    )

    if (regionOrganizationMap.size === 0) {
      return []
    }

    const runners = await this.runnerRepository.find({
      where: {
        region: In(Array.from(regionOrganizationMap.keys())),
      },
    })

    return runners
      .map((runner) => ({
        organizationId: regionOrganizationMap.get(runner.region),
        runner,
      }))
      .filter((entry): entry is ProviderRunner => Boolean(entry.organizationId))
  }

  private parseProbeTarget(runner: Runner): { host: string; port: number } | null {
    const rawUrl = runner.apiUrl ?? (runner.domain ? `http://${runner.domain}` : null)
    if (!rawUrl) {
      return null
    }

    try {
      const url = new URL(rawUrl.includes('://') ? rawUrl : `http://${rawUrl}`)
      const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
      if (!url.hostname || !Number.isFinite(port)) {
        return null
      }
      return { host: url.hostname, port }
    } catch {
      return null
    }
  }

  private probeTcp(host: string, port: number): Promise<number | null> {
    return new Promise((resolve) => {
      const startedAt = process.hrtime.bigint()
      const socket = new net.Socket()
      let settled = false
      let timer: NodeJS.Timeout | undefined

      const finish = (value: number | null) => {
        if (settled) {
          return
        }
        settled = true
        if (timer) {
          clearTimeout(timer)
        }
        socket.destroy()
        resolve(value)
      }

      timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)
      socket.once('connect', () => {
        const elapsedNs = Number(process.hrtime.bigint() - startedAt)
        finish(Math.round((elapsedNs / 1_000_000) * 100) / 100)
      })
      socket.once('error', () => finish(null))
      socket.connect(port, host)
    })
  }
}
