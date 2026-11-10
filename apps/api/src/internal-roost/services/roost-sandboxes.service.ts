/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { IsSafeDisplayStringConstraint } from '../../common/validators'
import { CreateSandboxDto } from '../../sandbox/dto/create-sandbox.dto'
import { CreateSandboxSnapshotDto } from '../../sandbox/dto/create-sandbox-snapshot.dto'
import { ResizeSandboxDto } from '../../sandbox/dto/resize-sandbox.dto'
import { SandboxDto } from '../../sandbox/dto/sandbox.dto'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { SandboxService } from '../../sandbox/services/sandbox.service'
import { OrganizationService } from '../../organization/services/organization.service'
import { CreateSandboxBody, SandboxControlResponse } from '../dto/internal-roost.dto'
import {
  PauseSandboxBody,
  ResizeSandboxBody,
  SandboxOperationResponse,
  SnapshotSandboxBody,
  SnapshotSandboxResponse,
} from '../dto/sandbox-ops.dto'

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
    const organization = await this.requireOrganization(orgId)
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
    const organization = await this.requireOrganization(orgId)
    const sandbox = await this.sandboxService.start(sandboxId, organization)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  async stopSandbox(orgId: string, sandboxId: string): Promise<SandboxControlResponse> {
    const sandbox = await this.sandboxService.stop(sandboxId, orgId)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  /**
   * Pause a sandbox (`SandboxService.pause`).
   * Only STARTED VM/Windows sandboxes can be paused; container sandboxes are rejected
   * by the existing service with 422.
   */
  async pauseSandbox(orgId: string, sandboxId: string, body?: PauseSandboxBody): Promise<SandboxOperationResponse> {
    // Pause takes no parameters; reject everything (including organizationId) loudly.
    assertOnlySupportedFields(body, PAUSE_SUPPORTED_FIELDS, 'pause')
    const organization = await this.requireOrganization(orgId)
    const sandbox = await this.sandboxService.pause(sandboxId, organization)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  /**
   * Resize a sandbox (`SandboxService.resize`).
   * Supported fields are exactly the fork's `ResizeSandboxDto`: cpu / memory / disk.
   */
  async resizeSandbox(orgId: string, sandboxId: string, body: ResizeSandboxBody): Promise<SandboxOperationResponse> {
    const resizeSandboxDto = buildResizeSandboxDto(body)
    const organization = await this.requireOrganization(orgId)
    const sandbox = await this.sandboxService.resize(sandboxId, resizeSandboxDto, organization)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return this.fromSandboxDto(sandboxDto)
  }

  /**
   * Create a snapshot from a sandbox (`SandboxService.createSnapshotFromSandbox`).
   * Snapshot creation is asynchronous; the response is the sandbox control view plus
   * the requested snapshot name.
   */
  async snapshotSandbox(
    orgId: string,
    sandboxId: string,
    body: SnapshotSandboxBody,
  ): Promise<SnapshotSandboxResponse> {
    const createSnapshotDto = buildCreateSandboxSnapshotDto(body)
    const organization = await this.requireOrganization(orgId)
    const sandbox = await this.sandboxService.createSnapshotFromSandbox(sandboxId, organization, createSnapshotDto)
    const sandboxDto = await this.sandboxService.toSandboxDto(sandbox)
    return { ...this.fromSandboxDto(sandboxDto), snapshot_name: createSnapshotDto.name }
  }

  private async requireOrganization(orgId: string) {
    const organization = await this.organizationService.findOne(orgId)
    if (!organization) {
      throw new NotFoundException(`Organization ${orgId} not found`)
    }
    return organization
  }

  private fromSandboxDto(sandbox: SandboxDto): SandboxOperationResponse {
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

/** Fields supported by the optional sandbox operations (fork capabilities, no fakes). */
export const PAUSE_SUPPORTED_FIELDS: string[] = []
export const RESIZE_SUPPORTED_FIELDS: string[] = ['cpu', 'memory', 'disk']
export const SNAPSHOT_SUPPORTED_FIELDS: string[] = ['name', 'includeMemory', 'include_memory']

const safeDisplayStringValidator = new IsSafeDisplayStringConstraint()

/**
 * Rejects unknown request-body fields with an explicit 400 that names both the
 * unsupported and the supported fields - never silently ignores them.
 */
export function assertOnlySupportedFields(
  body: Record<string, unknown> | undefined | null,
  supportedFields: string[],
  endpoint: string,
): Record<string, unknown> {
  if (body === undefined || body === null) {
    return {}
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object')
  }

  const unsupportedFields = Object.keys(body).filter((field) => !supportedFields.includes(field))
  if (unsupportedFields.length > 0) {
    const supported = supportedFields.length > 0 ? supportedFields.join(', ') : '(none)'
    throw new BadRequestException(
      `Unsupported field(s) for ${endpoint}: ${unsupportedFields.join(', ')}. Supported fields for ${endpoint}: ${supported}`,
    )
  }

  return body
}

/**
 * Builds the fork's `ResizeSandboxDto` (cpu/memory/disk) and rejects everything else,
 * including `organizationId` (the organization comes from the JWT claims only).
 */
export function buildResizeSandboxDto(body: ResizeSandboxBody): ResizeSandboxDto {
  const record = assertOnlySupportedFields(body, RESIZE_SUPPORTED_FIELDS, 'resize')
  const dto = new ResizeSandboxDto()
  let providedFields = 0

  for (const field of RESIZE_SUPPORTED_FIELDS as Array<'cpu' | 'memory' | 'disk'>) {
    const value = record[field]
    if (value === undefined || value === null) {
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
      throw new BadRequestException(`${field} must be a number >= 1`)
    }
    dto[field] = value
    providedFields += 1
  }

  if (providedFields === 0) {
    throw new BadRequestException(`resize requires at least one of: ${RESIZE_SUPPORTED_FIELDS.join(', ')}`)
  }

  return dto
}

/**
 * Builds the fork's `CreateSandboxSnapshotDto`.
 *
 * Supported: `name` (required, safe display string) and `includeMemory`
 * (`include_memory` accepted as snake_case alias; Windows sandboxes only - the
 * existing service validates that constraint).
 */
export function buildCreateSandboxSnapshotDto(body: SnapshotSandboxBody): CreateSandboxSnapshotDto {
  const record = assertOnlySupportedFields(body, SNAPSHOT_SUPPORTED_FIELDS, 'snapshot')

  const rawName = record.name
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new BadRequestException('name is required')
  }
  const name = rawName.trim()
  if (name.length > 255) {
    throw new BadRequestException('name must be at most 255 characters')
  }
  if (!safeDisplayStringValidator.validate(name)) {
    throw new BadRequestException('name must not contain HTML tags, URLs, or control characters')
  }

  const camelIncludeMemory = normalizeOptionalBoolean(record.includeMemory, 'includeMemory')
  const snakeIncludeMemory = normalizeOptionalBoolean(record.include_memory, 'include_memory')
  if (camelIncludeMemory !== undefined && snakeIncludeMemory !== undefined && camelIncludeMemory !== snakeIncludeMemory) {
    throw new BadRequestException('includeMemory and include_memory conflict')
  }

  const dto = new CreateSandboxSnapshotDto()
  dto.name = name
  const includeMemory = camelIncludeMemory ?? snakeIncludeMemory
  if (includeMemory !== undefined) {
    dto.includeMemory = includeMemory
  }
  return dto
}

function normalizeOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} must be a boolean`)
  }
  return value
}
