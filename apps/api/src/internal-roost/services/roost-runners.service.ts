/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Not, Repository } from 'typeorm'
import { Sandbox } from '../../sandbox/entities/sandbox.entity'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { RunnerService } from '../../sandbox/services/runner.service'
import { RegionService } from '../../region/services/region.service'
import { CreateRunnerBody, CreateRunnerResponse, RunnerHeartbeatResponse } from '../dto/internal-roost.dto'

/**
 * Runs the provider node lifecycle on the fork side:
 * - create a runner in the node's CUSTOM region (api_key returned exactly once)
 * - read the minimal heartbeat view used by the market node worker
 * - delete a runner once it is unschedulable/draining and has no sandboxes left
 *
 * Ownership is always verified through the runner's region owner, so an organization
 * can never see or touch another organization's nodes (404 is returned instead of 403
 * to avoid leaking node existence).
 */
@Injectable()
export class RoostRunnersService {
  private readonly logger = new Logger(RoostRunnersService.name)

  constructor(
    private readonly runnerService: RunnerService,
    private readonly regionService: RegionService,
    @InjectRepository(Sandbox)
    private readonly sandboxRepository: Repository<Sandbox>,
  ) {}

  async createRunner(orgId: string, regionId: string, body: CreateRunnerBody): Promise<CreateRunnerResponse> {
    const region = await this.regionService.findOne(regionId)
    if (!region) {
      throw new NotFoundException(`Region ${regionId} not found`)
    }
    if (region.organizationId !== orgId) {
      throw new NotFoundException(`Region ${regionId} not found`)
    }

    const { name, tags } = normalizeCreateRunnerBody(body)

    const { runner, apiKey } = await this.runnerService.create({
      apiVersion: '2',
      regionId,
      name,
      tags,
    })

    this.logger.log(`Created runner ${runner.id} in region ${regionId} for organization ${orgId}`)
    return { runner_id: runner.id, api_key: apiKey }
  }

  async getRunnerHeartbeat(orgId: string, runnerId: string): Promise<RunnerHeartbeatResponse> {
    const runner = await this.runnerService.findOne(runnerId)
    if (!runner) {
      throw new NotFoundException(`Runner ${runnerId} not found`)
    }

    const region = await this.regionService.findOne(runner.region)
    if (!region || region.organizationId !== orgId) {
      throw new NotFoundException(`Runner ${runnerId} not found`)
    }

    let sandboxCount: number | null = null
    try {
      sandboxCount = await this.sandboxRepository.count({
        where: {
          runnerId,
          state: Not(In([SandboxState.ARCHIVED, SandboxState.DESTROYED])),
        },
      })
    } catch (error) {
      // Heartbeat consumers can work without the count; never fail the poll for it.
      this.logger.warn(`Failed to count sandboxes for runner ${runnerId}: ${error?.message}`)
    }

    return {
      runner_id: runner.id,
      state: runner.state,
      last_seen_at: runner.lastChecked ? runner.lastChecked.toISOString() : null,
      sandbox_count: sandboxCount,
    }
  }

  async deleteRunner(orgId: string, runnerId: string): Promise<void> {
    const heartbeat = await this.getRunnerHeartbeat(orgId, runnerId)
    if (heartbeat.sandbox_count === null) {
      throw new BadRequestException(
        `Cannot delete runner ${runnerId}: its sandbox count could not be determined (not draining it)`,
      )
    }
    // `RunnerService.remove` requires the runner to be unschedulable. The internal
    // DELETE is the node-decommission entry point, so stop scheduling new sandboxes
    // first and let the existing checks reject the delete while sandboxes remain.
    await this.runnerService.updateSchedulingStatus(runnerId, true)
    await this.runnerService.remove(runnerId)
    this.logger.log(`Deleted runner ${runnerId} for organization ${orgId}`)
  }
}

export function normalizeCreateRunnerBody(body: CreateRunnerBody): { name: string; tags?: string[] } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length === 0) {
    throw new BadRequestException('name is required')
  }

  let tags: string[] | undefined
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      throw new BadRequestException('tags must be an array of strings')
    }
    tags = body.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
  }

  return { name, tags }
}
