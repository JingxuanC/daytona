/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Not, Repository } from 'typeorm'
import { RunnerService } from '../../sandbox/services/runner.service'
import {
  ProviderAlertItemDto,
  ProviderAlertsQueryDto,
  ProviderAlertsResponseDto,
} from '../dto/provider-alert.dto'
import { RunnerAlert, RunnerAlertSeverity, RunnerAlertType } from '../entities/runner-alert.entity'

const DEFAULT_ALERT_LIMIT = 50

@Injectable()
export class ProviderAlertsService {
  constructor(
    @InjectRepository(RunnerAlert)
    private readonly alertRepository: Repository<RunnerAlert>,
    private readonly runnerService: RunnerService,
  ) {}

  async listAlerts(
    organizationId: string,
    query: ProviderAlertsQueryDto = {},
  ): Promise<ProviderAlertsResponseDto> {
    const state = query.state ?? 'open'

    const alerts = await this.alertRepository.find({
      where: {
        organizationId,
        ...(state === 'open' ? { resolvedAt: IsNull() } : {}),
        ...(state === 'resolved' ? { resolvedAt: Not(IsNull()) } : {}),
        ...(query.runnerId ? { runnerId: query.runnerId } : {}),
      },
      order: {
        resolvedAt: 'ASC',
        createdAt: 'DESC',
      },
      take: query.limit ?? DEFAULT_ALERT_LIMIT,
    })

    const runnerNameMap = await this.resolveRunnerNames(alerts.map((alert) => alert.runnerId))

    return {
      items: alerts.map((alert) => this.toItem(alert, runnerNameMap.get(alert.runnerId) ?? '')),
    }
  }

  async resolveAlert(organizationId: string, id: string): Promise<ProviderAlertItemDto> {
    const alert = await this.alertRepository.findOne({
      where: {
        id,
        organizationId,
      },
    })

    if (!alert) {
      throw new NotFoundException('Alert not found')
    }

    if (!alert.resolvedAt) {
      alert.resolvedAt = new Date()
      await this.alertRepository.save(alert)
    }

    const runnerNameMap = await this.resolveRunnerNames([alert.runnerId])

    return this.toItem(alert, runnerNameMap.get(alert.runnerId) ?? '')
  }

  /**
   * Raises an alert unless an open alert of the same type already exists for the node.
   * Returns true when a new alert row was created.
   */
  async raiseAlert(params: {
    organizationId: string
    runnerId: string
    type: RunnerAlertType
    severity: RunnerAlertSeverity
    message: string
    details?: Record<string, unknown> | null
  }): Promise<boolean> {
    const existing = await this.alertRepository.findOne({
      where: {
        runnerId: params.runnerId,
        type: params.type,
        resolvedAt: IsNull(),
      },
    })

    if (existing) {
      return false
    }

    await this.alertRepository.save(
      this.alertRepository.create({
        organizationId: params.organizationId,
        runnerId: params.runnerId,
        type: params.type,
        severity: params.severity,
        message: params.message,
        details: params.details ?? null,
        resolvedAt: null,
      }),
    )

    return true
  }

  /**
   * Resolves every open alert of the given type for a node (used when the node recovers).
   */
  async resolveOpenAlerts(runnerId: string, type: RunnerAlertType): Promise<number> {
    const result = await this.alertRepository.update(
      {
        runnerId,
        type,
        resolvedAt: IsNull(),
      },
      {
        resolvedAt: new Date(),
      },
    )

    return result.affected ?? 0
  }

  async getOpenAlertCounts(runnerIds: string[]): Promise<Map<string, number>> {
    if (runnerIds.length === 0) {
      return new Map()
    }

    const rows = await this.alertRepository
      .createQueryBuilder('alert')
      .select('alert.runnerId', 'runnerId')
      .addSelect('COUNT(*)', 'count')
      .where('alert.runnerId IN (:...runnerIds)', { runnerIds })
      .andWhere('alert.resolvedAt IS NULL')
      .groupBy('alert.runnerId')
      .getRawMany<{ runnerId: string; count: string }>()

    return new Map(rows.map((row) => [row.runnerId, Number(row.count)]))
  }

  private toItem(alert: RunnerAlert, runnerName: string): ProviderAlertItemDto {
    return {
      id: alert.id,
      runnerId: alert.runnerId,
      runnerName,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      details: alert.details ?? null,
      createdAt: alert.createdAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    }
  }

  private async resolveRunnerNames(runnerIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = Array.from(new Set(runnerIds.filter(Boolean)))
    if (uniqueIds.length === 0) {
      return new Map()
    }
    const runners = await this.runnerService.findByIds(uniqueIds)
    return new Map(runners.map((runner) => [runner.id, runner.name]))
  }
}
