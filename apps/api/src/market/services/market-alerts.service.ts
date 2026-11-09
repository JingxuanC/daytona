/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository } from 'typeorm'
import { MarketAlert } from '../entities/market-alert.entity'
import { MarketAlertSeverity, MarketAlertType } from '../enums/market-alert-type.enum'

@Injectable()
export class MarketAlertsService {
  constructor(
    @InjectRepository(MarketAlert)
    private readonly alertRepository: Repository<MarketAlert>,
  ) {}

  async list(organizationId: string, state: 'open' | 'all' = 'open'): Promise<MarketAlert[]> {
    return this.alertRepository.find({
      where: state === 'open' ? { organizationId, resolvedAt: IsNull() } : { organizationId },
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }

  async countOpenByOrganization(organizationId: string): Promise<number> {
    return this.alertRepository.count({ where: { organizationId, resolvedAt: IsNull() } })
  }

  /** Raises an alert unless an unresolved alert of the same type already exists. */
  async raise(
    organizationId: string,
    type: MarketAlertType,
    severity: MarketAlertSeverity,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<MarketAlert> {
    const existing = await this.alertRepository.findOne({
      where: { organizationId, type, resolvedAt: IsNull() },
    })
    if (existing) {
      return existing
    }
    const alert = this.alertRepository.create({
      organizationId,
      type,
      severity,
      message,
      details: details ?? null,
    })
    return this.alertRepository.save(alert)
  }

  async resolve(organizationId: string, type: MarketAlertType): Promise<number> {
    const result = await this.alertRepository.update(
      { organizationId, type, resolvedAt: IsNull() },
      { resolvedAt: new Date() },
    )
    return result.affected ?? 0
  }

  async resolveAll(organizationId: string): Promise<number> {
    const result = await this.alertRepository.update(
      { organizationId, resolvedAt: IsNull() },
      { resolvedAt: new Date() },
    )
    return result.affected ?? 0
  }

  /** Organizations that currently have any open market alert. */
  async getOrganizationsWithOpenAlerts(): Promise<string[]> {
    const rows = await this.alertRepository
      .createQueryBuilder('alert')
      .select('DISTINCT alert."organizationId"', 'organizationId')
      .where('alert."resolvedAt" IS NULL')
      .getRawMany<{ organizationId: string }>()
    return rows.map((row) => row.organizationId)
  }
}
