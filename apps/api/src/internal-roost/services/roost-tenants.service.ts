/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { TypedConfigService } from '../../config/typed-config.service'
import { OrganizationService } from '../../organization/services/organization.service'
import { ProvisionTenantBody, ProvisionTenantResponse } from '../dto/internal-roost.dto'
import { RoostTenantMapping } from '../entities/roost-tenant-mapping.entity'
import { ROOST_CREATED_BY_PREFIX, ROOST_TENANT_MAPPING_STATE_READY } from '../internal-roost.constants'

/**
 * Idempotently provisions a Daytona organization for a market-service tenant.
 *
 * `external_id` is the idempotency key: the unique `roost_tenant_mappings.externalId`
 * column guarantees that concurrent/retried calls return the same organization.
 */
@Injectable()
export class RoostTenantsService {
  private readonly logger = new Logger(RoostTenantsService.name)

  constructor(
    @InjectRepository(RoostTenantMapping)
    private readonly tenantMappingRepository: Repository<RoostTenantMapping>,
    private readonly organizationService: OrganizationService,
    private readonly configService: TypedConfigService,
  ) {}

  async provision(body: ProvisionTenantBody): Promise<ProvisionTenantResponse & { created: boolean }> {
    const { externalId, name, ownerEmail } = normalizeProvisionTenantBody(body)

    const existing = await this.tenantMappingRepository.findOne({ where: { externalId } })
    if (existing) {
      const organization = await this.organizationService.findOne(existing.organizationId)
      if (!organization) {
        // Mapping without an organization should not happen (FK cascade), but never
        // silently hand out a dangling organization id.
        throw new ConflictException(`Tenant ${externalId} is mapped to an organization that no longer exists`)
      }
      await this.ensureDefaultRegion(organization)
      return { organization_id: organization.id, state: this.resolveState(organization.suspended), created: false }
    }

    const organization = await this.organizationService.create(
      { name },
      `${ROOST_CREATED_BY_PREFIX}${externalId}`,
      false,
      true,
    )

    await this.ensureDefaultRegion(organization)

    if (organization.suspended) {
      // Internal tenants are platform-managed: a freshly provisioned tenant that is
      // suspended only because of the email/billing gate would never become usable.
      // The market service owns the tenant lifecycle and payment state, so activate it.
      this.logger.log(`Unsuspending organization ${organization.id} provisioned for tenant ${externalId}`)
      await this.organizationService.unsuspend(organization.id)
      organization.suspended = false
    }

    const mapping = new RoostTenantMapping()
    mapping.externalId = externalId
    mapping.organizationId = organization.id
    mapping.state = ROOST_TENANT_MAPPING_STATE_READY

    try {
      await this.tenantMappingRepository.save(mapping)
    } catch (error) {
      // Lost a concurrent race: return whatever mapping won.
      if (error?.code === '23505') {
        const winner = await this.tenantMappingRepository.findOne({ where: { externalId } })
        if (winner) {
          return { organization_id: winner.organizationId, state: this.resolveState(false), created: false }
        }
      }
      throw error
    }

    this.logger.log(`Provisioned tenant ${externalId} (${ownerEmail ?? 'no owner email'}) as organization ${organization.id}`)
    return { organization_id: organization.id, state: this.resolveState(false), created: true }
  }

  async findMappingByOrganizationId(organizationId: string): Promise<RoostTenantMapping | null> {
    return this.tenantMappingRepository.findOne({ where: { organizationId } })
  }

  private resolveState(suspended: boolean): string {
    return suspended ? 'suspended' : ROOST_TENANT_MAPPING_STATE_READY
  }

  /**
   * Sandbox creation requires an organization default region even when the caller
   * always passes an explicit `target` (Daytona validates the default region first).
   * Market tenants are created without one, so point it at the platform SHARED default
   * region. Idempotent and safe to retry on every provision call.
   */
  private async ensureDefaultRegion(organization: { id: string; defaultRegionId?: string | null }): Promise<void> {
    if (organization.defaultRegionId) {
      return
    }
    const defaultRegionId = this.configService.get('defaultRegion.id')
    if (!defaultRegionId) {
      return
    }
    try {
      await this.organizationService.setDefaultRegion(organization.id, defaultRegionId)
      organization.defaultRegionId = defaultRegionId
    } catch (error) {
      // A concurrent provision may have set it in the meantime.
      const refreshed = await this.organizationService.findOne(organization.id)
      if (refreshed?.defaultRegionId) {
        organization.defaultRegionId = refreshed.defaultRegionId
        return
      }
      throw new ConflictException(
        `Tenant organization ${organization.id} has no default region and ${defaultRegionId} could not be set: ${(error as Error).message}`,
      )
    }
  }
}

export function normalizeProvisionTenantBody(body: ProvisionTenantBody): {
  externalId: string
  name: string
  ownerEmail: string | null
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body is required')
  }

  const externalId = normalizeRequiredString(body.external_id ?? body.externalId, 'external_id', 255)
  const name =
    (body.name ?? '').toString().trim().length > 0
      ? (body.name as string).trim()
      : `tenant-${externalId.slice(0, 8)}`
  const ownerEmail = normalizeOptionalEmail(body.owner_email ?? body.ownerEmail)

  if (name.length > 255) {
    throw new BadRequestException('name must be at most 255 characters')
  }

  return { externalId, name, ownerEmail }
}

function normalizeRequiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} must be at most ${maxLength} characters`)
  }
  return trimmed
}

function normalizeOptionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new BadRequestException('owner_email must be a valid email address')
  }
  return value.trim()
}
