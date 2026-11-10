/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CreateSandboxDto } from '../../sandbox/dto/create-sandbox.dto'
import { SandboxDto } from '../../sandbox/dto/sandbox.dto'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { SandboxService } from '../../sandbox/services/sandbox.service'
import { OrganizationService } from '../../organization/services/organization.service'
import { CreateSandboxBody, SandboxControlResponse } from '../dto/internal-roost.dto'

/**
 * Sandbox control on behalf of a market-service organization.
 *
 * The organization always comes from the JWT claims (`orgId` argument); any
 * `organizationId` in the request body is ignored by design. All work is delegated to
 * the existing `SandboxService` - no sandbox lifecycle logic is duplicated here.
 */
@Injectable()
export class RoostSandboxesService {
  private readonly logger = new Logger(RoostSandboxesService.name)

  constructor(
    private readonly sandboxService: SandboxService,
    private readonly organizationService: OrganizationService,
  ) {}

  async createSandbox(orgId: string, body: CreateSandboxBody): Promise<SandboxControlResponse> {
    const organization = await this.organizationService.findOne(orgId)
    if (!organization) {
      throw new NotFoundException(`Organization ${orgId} not found`)
    }
    this.organizationService.assertOrganizationIsNotSuspended(organization)

    const createSandboxDto = buildCreateSandboxDto(body)
    const sandbox = await this.sandboxService.createFromSnapshot(createSandboxDto, organization)

    return {
      id: sandbox.id,
      state: mapSandboxState(sandbox.state),
      organization_id: orgId,
    }
  }

  async getSandbox(orgId: string, sandboxId: string): Promise<SandboxControlResponse> {
    const sandbox = await this.sandboxService.findOneByIdOrName(sandboxId, orgId)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  async deleteSandbox(orgId: string, sandboxId: string): Promise<void> {
    await this.sandboxService.destroy(sandboxId, orgId)
  }

  async startSandbox(orgId: string, sandboxId: string): Promise<SandboxControlResponse> {
    const organization = await this.organizationService.findOne(orgId)
    if (!organization) {
      throw new NotFoundException(`Organization ${orgId} not found`)
    }
    const sandbox = await this.sandboxService.start(sandboxId, organization)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  async stopSandbox(orgId: string, sandboxId: string): Promise<SandboxControlResponse> {
    const sandbox = await this.sandboxService.stop(sandboxId, orgId)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  private fromSandboxDto(sandbox: SandboxDto): SandboxControlResponse {
    return {
      id: sandbox.id,
      state: mapSandboxState(sandbox.state),
      organization_id: sandbox.organizationId,
    }
  }
}

/**
 * Maps every Daytona sandbox state onto the stable state set frozen in the internal
 * contract (`creating/starting/started/stopping/stopped/pausing/paused/deleting/
 * deleted/error`).
 *
 * Exported for unit testing; several internal Daytona states necessarily collapse.
 */
export function mapSandboxState(state: SandboxState | string): string {
  switch (state) {
    case SandboxState.CREATING:
    case SandboxState.PENDING_BUILD:
    case SandboxState.BUILDING_SNAPSHOT:
      return 'creating'
    case SandboxState.STARTING:
    case SandboxState.RESTORING:
    case SandboxState.RESUMING:
    case SandboxState.PULLING_SNAPSHOT:
      return 'starting'
    case SandboxState.STARTED:
    case SandboxState.RESIZING:
    case SandboxState.SNAPSHOTTING:
    case SandboxState.FORKING:
      return 'started'
    case SandboxState.STOPPING:
    case SandboxState.ARCHIVING:
      return 'stopping'
    case SandboxState.STOPPED:
    case SandboxState.ARCHIVED:
      return 'stopped'
    case SandboxState.PAUSING:
      return 'pausing'
    case SandboxState.PAUSED:
      return 'paused'
    case SandboxState.DESTROYING:
      return 'deleting'
    case SandboxState.DESTROYED:
      return 'deleted'
    case SandboxState.ERROR:
    case SandboxState.BUILD_FAILED:
    default:
      return 'error'
  }
}

/**
 * Builds the regular `CreateSandboxDto` from the internal contract body.
 *
 * Daytona v1 always derives sandbox resources from the snapshot, so the contract's
 * `cpu`/`memory_gib`/`disk_gib` are accepted for compatibility but not applied (the
 * snapshot is authoritative; the market lease quota is enforced through
 * `region_quota`). The optional `region_id`/`target` fork extension pins the sandbox
 * to the provider node's CUSTOM region.
 */
export function buildCreateSandboxDto(body: CreateSandboxBody): CreateSandboxDto {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const snapshot = normalizeRequiredString(body.snapshot, 'snapshot')
  const dto = new CreateSandboxDto()
  dto.snapshot = snapshot

  if (body.name !== undefined) {
    dto.name = normalizeRequiredString(body.name, 'name')
  }

  const target = body.region_id ?? body.regionId ?? body.target
  if (target !== undefined && target !== null && target !== '') {
    dto.target = normalizeRequiredString(target, 'region_id')
  }

  if (body.user !== undefined && body.user !== null) {
    dto.user = normalizeRequiredString(body.user, 'user')
  }

  if (body.env !== undefined && body.env !== null) {
    if (typeof body.env !== 'object' || Array.isArray(body.env)) {
      throw new BadRequestException('env must be an object of string values')
    }
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.env)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(`env.${key} must be a string`)
      }
      env[key] = value
    }
    dto.env = env
  }

  const autoStopMinutes = body.auto_stop_minutes ?? body.autoStopMinutes
  if (autoStopMinutes !== undefined && autoStopMinutes !== null) {
    const numeric = Number(autoStopMinutes)
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw new BadRequestException('auto_stop_minutes must be a non-negative integer')
    }
    dto.autoStopInterval = numeric
  }

  if (body.public !== undefined && body.public !== null) {
    if (typeof body.public !== 'boolean') {
      throw new BadRequestException('public must be a boolean')
    }
    dto.public = body.public
  }

  return dto
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`)
  }
  return value.trim()
}
