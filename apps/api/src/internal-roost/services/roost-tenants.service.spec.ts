/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ConflictException } from '@nestjs/common'
import { RoostTenantMapping } from '../entities/roost-tenant-mapping.entity'
import { normalizeProvisionTenantBody, RoostTenantsService } from './roost-tenants.service'

function createTenantMappingRepository(initial: RoostTenantMapping[] = []): any {
  const rows: RoostTenantMapping[] = [...initial]
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => rows.find((row) => row.externalId === where.externalId) ?? null),
    save: jest.fn(async (row: RoostTenantMapping) => {
      rows.push(row)
      return row
    }),
  }
}

function createConfigService(): any {
  return {
    get: (key: string) => (key === 'defaultRegion.id' ? 'us' : undefined),
  }
}

function createOrganizationService(overrides: Record<string, jest.Mock> = {}): any {
  return {
    findOne: jest.fn(async (id: string) => ({ id, name: 'tenant', suspended: false, defaultRegionId: 'us' })),
    create: jest.fn(async (dto: { name: string }, createdBy: string) => ({
      id: `org-for-${createdBy}`,
      name: dto.name,
      suspended: false,
      defaultRegionId: 'us',
    })),
    setDefaultRegion: jest.fn(async () => undefined),
    unsuspend: jest.fn(async () => undefined),
    ...overrides,
  }
}

describe('RoostTenantsService', () => {
  it('creates an organization and the tenant mapping on first call', async () => {
    const repository = createTenantMappingRepository()
    const organizationService = createOrganizationService()
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    const result = await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme', owner_email: 'a@b.co' })

    expect(result.created).toBe(true)
    expect(result.state).toBe('ready')
    expect(result.organization_id).toBe('org-for-roost:tenant:tenant-uuid-1')
    expect(organizationService.create).toHaveBeenCalledWith(
      { name: 'Acme' },
      'roost:tenant:tenant-uuid-1',
      false,
      true,
    )
    expect(repository.rows).toHaveLength(1)
    expect(repository.rows[0].externalId).toBe('tenant-uuid-1')
  })

  it('is idempotent for the same external_id', async () => {
    const repository = createTenantMappingRepository()
    const organizationService = createOrganizationService()
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    const first = await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })
    const second = await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme renamed' })

    expect(second.created).toBe(false)
    expect(second.organization_id).toBe(first.organization_id)
    expect(organizationService.create).toHaveBeenCalledTimes(1)
    expect(repository.rows).toHaveLength(1)
  })

  it('returns the winning mapping when a concurrent request wins the unique constraint race', async () => {
    const repository = createTenantMappingRepository()
    const raceError = new Error('duplicate key value violates unique constraint') as Error & { code: string }
    raceError.code = '23505'
    repository.findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ externalId: 'tenant-uuid-1', organizationId: 'org-winner', state: 'ready' })
    repository.save = jest.fn().mockRejectedValueOnce(raceError)
    const organizationService = createOrganizationService()
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    const result = await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })

    expect(result).toMatchObject({ organization_id: 'org-winner', created: false })
  })

  it('fails loudly when a mapping points to a deleted organization', async () => {
    const repository = createTenantMappingRepository()
    repository.findOne = jest.fn().mockResolvedValue({
      externalId: 'tenant-uuid-1',
      organizationId: 'org-gone',
      state: 'ready',
    })
    const organizationService = createOrganizationService({ findOne: jest.fn().mockResolvedValue(null) })
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    await expect(service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('activates an organization that the email/billing gate suspended', async () => {
    const repository = createTenantMappingRepository()
    const organizationService = createOrganizationService({
      create: jest.fn(async () => ({ id: 'org-1', name: 'Acme', suspended: true, defaultRegionId: 'us' })),
    })
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })

    expect(organizationService.unsuspend).toHaveBeenCalledWith('org-1')
  })
})

describe('normalizeProvisionTenantBody', () => {
  it('requires an external_id', () => {
    expect(() => normalizeProvisionTenantBody({})).toThrow(BadRequestException)
  })

  it('accepts camelCase aliases and derives a fallback name', () => {
    const normalized = normalizeProvisionTenantBody({ externalId: 'tenant-uuid-1' })
    expect(normalized.externalId).toBe('tenant-uuid-1')
    expect(normalized.name).toBe('tenant-tenant-u')
  })

  it('rejects an invalid owner_email', () => {
    expect(() =>
      normalizeProvisionTenantBody({ external_id: 'tenant-uuid-1', name: 'Acme', owner_email: 'nope' }),
    ).toThrow(BadRequestException)
  })
})


describe('RoostTenantsService default region', () => {
  it('sets the platform default region for a new tenant', async () => {
    const repository = createTenantMappingRepository()
    const organizationService = createOrganizationService({
      create: jest.fn(async () => ({ id: 'org-1', name: 'Acme', suspended: false, defaultRegionId: null })),
    })
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    await service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })

    expect(organizationService.setDefaultRegion).toHaveBeenCalledWith('org-1', 'us')
  })

  it('fails provisioning when the default region cannot be set (sandbox creation would be impossible)', async () => {
    const repository = createTenantMappingRepository()
    const organizationService = createOrganizationService({
      create: jest.fn(async () => ({ id: 'org-1', name: 'Acme', suspended: false, defaultRegionId: null })),
      setDefaultRegion: jest.fn(async () => {
        throw new Error('Region not found')
      }),
      findOne: jest.fn(async () => ({ id: 'org-1', defaultRegionId: null })),
    })
    const service = new RoostTenantsService(repository, organizationService, createConfigService())

    await expect(service.provision({ external_id: 'tenant-uuid-1', name: 'Acme' })).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})
