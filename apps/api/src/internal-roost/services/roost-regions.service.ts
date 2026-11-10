/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OrganizationService } from '../../organization/services/organization.service'
import { RegionType } from '../../region/enums/region-type.enum'
import { RegionService } from '../../region/services/region.service'
import { CreateRegionBody, CreateRegionResponse } from '../dto/internal-roost.dto'
import { roostRegionIdForNode } from '../internal-roost.constants'

/**
 * Creates the node-exclusive CUSTOM region for a provider node.
 *
 * V1 mapping is deterministic: one node external id owns exactly one region
 * (`node_<uuid-without-dashes>`), so a repeated call (idempotent retry) returns the
 * same `region_id` instead of creating a second region.
 */
@Injectable()
export class RoostRegionsService {
  private readonly logger = new Logger(RoostRegionsService.name)

  constructor(
    private readonly regionService: RegionService,
    private readonly organizationService: OrganizationService,
  ) {}

  async createRegion(orgId: string, body: CreateRegionBody): Promise<CreateRegionResponse & { created: boolean }> {
    const { name, nodeExternalId } = normalizeCreateRegionBody(body)

    const organization = await this.organizationService.findOne(orgId)
    if (!organization) {
      throw new NotFoundException(`Organization ${orgId} not found`)
    }

    const regionId = roostRegionIdForNode(nodeExternalId)
    const existing = await this.regionService.findOne(regionId)
    if (existing) {
      if (existing.organizationId !== orgId) {
        throw new ConflictException(`Node ${nodeExternalId} is already assigned to another organization`)
      }
      return { region_id: existing.id, created: false }
    }

    const existingByName = await this.regionService.findOneByName(name, orgId)
    if (existingByName) {
      throw new ConflictException(`Region with name ${name} already exists for this organization`)
    }

    await this.regionService.create(
      {
        id: regionId,
        name,
        enforceQuotas: true,
        regionType: RegionType.CUSTOM,
      },
      orgId,
    )

    this.logger.log(`Created CUSTOM region ${regionId} for node ${nodeExternalId} (organization ${orgId})`)
    return { region_id: regionId, created: true }
  }
}

export function normalizeCreateRegionBody(body: CreateRegionBody): { name: string; nodeExternalId: string } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length === 0) {
    throw new BadRequestException('name is required')
  }
  if (name.length < 3 || name.length > 255) {
    throw new BadRequestException('name must be between 3 and 255 characters')
  }

  const nodeExternalId = normalizeNodeExternalId(body.node_external_id ?? body.nodeExternalId)
  return { name, nodeExternalId }
}

function normalizeNodeExternalId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException('node_external_id is required')
  }
  const trimmed = value.trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed) || trimmed.length > 128) {
    throw new BadRequestException('node_external_id must be an id made of letters, numbers, underscores or dashes')
  }
  return trimmed
}
