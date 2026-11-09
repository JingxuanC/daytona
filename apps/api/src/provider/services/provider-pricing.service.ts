/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { RunnerService } from '../../sandbox/services/runner.service'
import {
  ProviderPricingItemDto,
  ProviderPricingResponseDto,
  UpsertProviderPricingDto,
} from '../dto/provider-pricing.dto'
import { DEFAULT_PRICING_CURRENCY, RunnerPricing } from '../entities/runner-pricing.entity'
import { ProviderNodesService } from './provider-nodes.service'

@Injectable()
export class ProviderPricingService {
  constructor(
    @InjectRepository(RunnerPricing)
    private readonly pricingRepository: Repository<RunnerPricing>,
    private readonly runnerService: RunnerService,
    private readonly providerNodesService: ProviderNodesService,
  ) {}

  async getPricingMap(organizationId: string): Promise<Map<string, RunnerPricing>> {
    const rows = await this.pricingRepository.find({
      where: {
        organizationId,
      },
    })

    return new Map(rows.map((row) => [row.runnerId, row]))
  }

  async listPricing(organizationId: string): Promise<ProviderPricingResponseDto> {
    const [runners, pricingMap] = await Promise.all([
      this.runnerService.findAllByOrganization(organizationId),
      this.getPricingMap(organizationId),
    ])

    const items: ProviderPricingItemDto[] = runners
      .map((runner) => {
        const pricing = pricingMap.get(runner.id)
        return {
          runnerId: runner.id,
          runnerName: runner.name,
          cpuHourCents: pricing?.cpuHourCents ?? 0,
          memoryGiBHourCents: pricing?.memoryGiBHourCents ?? 0,
          diskGiBHourCents: pricing?.diskGiBHourCents ?? 0,
          gpuHourCents: pricing?.gpuHourCents ?? 0,
          updatedAt: pricing?.updatedAt?.toISOString() ?? null,
        }
      })
      .sort((a, b) => a.runnerName.localeCompare(b.runnerName))

    return {
      currency: items.length > 0 ? (pricingMap.get(items[0].runnerId)?.currency ?? DEFAULT_PRICING_CURRENCY) : DEFAULT_PRICING_CURRENCY,
      items,
    }
  }

  async upsertPricing(
    organizationId: string,
    runnerId: string,
    dto: UpsertProviderPricingDto,
  ): Promise<ProviderPricingItemDto> {
    const runner = await this.providerNodesService.getOwnedRunnerOrFail(organizationId, runnerId)

    let pricing = await this.pricingRepository.findOne({
      where: {
        organizationId,
        runnerId,
      },
    })

    if (!pricing) {
      pricing = this.pricingRepository.create({
        organizationId,
        runnerId,
      })
    }

    pricing.cpuHourCents = dto.cpuHourCents
    pricing.memoryGiBHourCents = dto.memoryGiBHourCents
    pricing.diskGiBHourCents = dto.diskGiBHourCents
    pricing.gpuHourCents = dto.gpuHourCents
    if (dto.currency) {
      pricing.currency = dto.currency.toUpperCase()
    }

    const saved = await this.pricingRepository.save(pricing)

    return {
      runnerId: saved.runnerId,
      runnerName: runner.name,
      cpuHourCents: saved.cpuHourCents,
      memoryGiBHourCents: saved.memoryGiBHourCents,
      diskGiBHourCents: saved.diskGiBHourCents,
      gpuHourCents: saved.gpuHourCents,
      updatedAt: saved.updatedAt?.toISOString() ?? null,
    }
  }
}
