/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, NotFoundException } from '@nestjs/common'
import { RegionService } from '../../region/services/region.service'
import { RunnerDto } from '../../sandbox/dto/runner.dto'
import { SandboxRepository } from '../../sandbox/repositories/sandbox.repository'
import { RunnerService } from '../../sandbox/services/runner.service'
import { ProviderNodeDto } from '../dto/provider-node.dto'
import { ProviderSandboxDto } from '../dto/provider-sandbox.dto'
import { ProviderMetricsService } from './provider-metrics.service'

const MAX_NODE_SANDBOXES = 200

@Injectable()
export class ProviderNodesService {
  constructor(
    private readonly runnerService: RunnerService,
    private readonly regionService: RegionService,
    private readonly sandboxRepository: SandboxRepository,
    private readonly providerMetricsService: ProviderMetricsService,
  ) {}

  /**
   * Returns every runner (compute node) owned by the organization together with the
   * latest reported health metrics.
   */
  async listNodes(organizationId: string): Promise<ProviderNodeDto[]> {
    const [regions, runners] = await Promise.all([
      this.regionService.findAllByOrganization(organizationId),
      this.runnerService.findAllByOrganization(organizationId),
    ])

    const regionNameMap = new Map(regions.map((region) => [region.id, region.name]))
    const metricsMap = await this.providerMetricsService.getMetricsForRunners(runners.map((runner) => runner.id))

    return runners.map((runner) =>
      ProviderNodeDto.fromRunner(
        runner,
        regionNameMap.get(runner.region) ?? runner.region,
        metricsMap.get(runner.id),
      ),
    )
  }

  /**
   * Loads a runner and verifies that it belongs to the organization. A runner belongs to
   * an organization when the region it is registered in is owned by that organization.
   */
  async getOwnedRunnerOrFail(organizationId: string, runnerId: string): Promise<RunnerDto> {
    const runner = await this.runnerService.findOne(runnerId)
    if (!runner) {
      throw new NotFoundException('Runner not found')
    }

    const regionOrganizationId = await this.regionService.getOrganizationId(runner.region)
    if (regionOrganizationId !== organizationId) {
      throw new NotFoundException('Runner not found')
    }

    return RunnerDto.fromRunner(runner)
  }

  /**
   * Lists the sandboxes currently assigned to a compute node of the organization.
   */
  async listNodeSandboxes(organizationId: string, runnerId: string): Promise<ProviderSandboxDto[]> {
    await this.getOwnedRunnerOrFail(organizationId, runnerId)

    const sandboxes = await this.sandboxRepository.find({
      where: {
        runnerId,
        organizationId,
      },
      order: {
        createdAt: 'DESC',
      },
      take: MAX_NODE_SANDBOXES,
    })

    return sandboxes.map(ProviderSandboxDto.fromSandbox)
  }
}
