/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import { buildCreateSandboxDto, mapSandboxState, RoostSandboxesService } from './roost-sandboxes.service'

const ORG = { id: 'org-jwt', name: 'tenant', suspended: false }

function createService(overrides: { assertSuspended?: boolean } = {}) {
  const sandboxDto = { id: 'sbx-1', state: SandboxState.STARTED, organizationId: 'org-jwt' }
  const sandboxService = {
    createFromSnapshot: jest.fn(async (...args: any[]) => {
      void args
      return sandboxDto
    }),
    findOneByIdOrName: jest.fn(async (...args: any[]) => {
      void args
      return { id: 'sbx-1', organizationId: 'org-jwt' }
    }),
    toSandboxDto: jest.fn(async (sandbox: any) => ({ ...sandboxDto, state: sandbox?.state ?? sandboxDto.state })),
    destroy: jest.fn(async (...args: any[]) => {
      void args
      return { id: 'sbx-1' }
    }),
    start: jest.fn(async (...args: any[]) => {
      void args
      return { id: 'sbx-1', state: SandboxState.STARTED }
    }),
    stop: jest.fn(async (...args: any[]) => {
      void args
      return { id: 'sbx-1', state: SandboxState.STOPPED }
    }),
  }
  const organizationService = {
    findOne: jest.fn(async () => ORG),
    assertOrganizationIsNotSuspended: jest.fn(() => {
      if (overrides.assertSuspended) {
        throw new ForbiddenException('Organization is suspended')
      }
    }),
  }
  const service = new RoostSandboxesService(sandboxService as any, organizationService as any)
  return { service, sandboxService, organizationService }
}

describe('RoostSandboxesService', () => {
  it('creates the sandbox with the organization from the credential, ignoring body organizationId', async () => {
    const { service, sandboxService } = createService()

    const result = await service.createSandbox('org-jwt', {
      name: 'sandbox-1',
      snapshot: 'ubuntu:24.04',
      // A hostile/buggy caller must not be able to pick another organization.
      organizationId: 'other-org',
    } as any)

    expect(sandboxService.createFromSnapshot).toHaveBeenCalledTimes(1)
    const [, organization] = sandboxService.createFromSnapshot.mock.calls[0]
    expect(organization).toBe(ORG)
    expect(result).toEqual({ id: 'sbx-1', state: 'started', organization_id: 'org-jwt' })
  })

  it('rejects creation for a suspended organization', async () => {
    const { service, sandboxService } = createService({ assertSuspended: true })

    await expect(service.createSandbox('org-jwt', { snapshot: 'ubuntu:24.04' })).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(sandboxService.createFromSnapshot).not.toHaveBeenCalled()
  })

  it('reads a sandbox scoped to the credential organization', async () => {
    const { service, sandboxService } = createService()

    const result = await service.getSandbox('org-jwt', 'sbx-1')

    expect(sandboxService.findOneByIdOrName).toHaveBeenCalledWith('sbx-1', 'org-jwt')
    expect(result).toEqual({ id: 'sbx-1', state: 'started', organization_id: 'org-jwt' })
  })

  it('deletes, starts and stops through SandboxService with the credential organization', async () => {
    const { service, sandboxService, organizationService } = createService()

    await service.deleteSandbox('org-jwt', 'sbx-1')
    expect(sandboxService.destroy).toHaveBeenCalledWith('sbx-1', 'org-jwt')

    const started = await service.startSandbox('org-jwt', 'sbx-1')
    expect(organizationService.findOne).toHaveBeenCalledWith('org-jwt')
    expect(sandboxService.start).toHaveBeenCalledWith('sbx-1', ORG)
    expect(started.state).toBe('started')

    const stopped = await service.stopSandbox('org-jwt', 'sbx-1')
    expect(sandboxService.stop).toHaveBeenCalledWith('sbx-1', 'org-jwt')
    expect(stopped.state).toBe('stopped')
  })
})

describe('buildCreateSandboxDto', () => {
  it('maps the contract body to CreateSandboxDto (resources come from the snapshot)', () => {
    const dto = buildCreateSandboxDto({
      name: 'sandbox-1',
      snapshot: 'ubuntu:24.04',
      env: { A: '1' },
      auto_stop_minutes: 30,
      public: true,
      user: 'daytona',
      region_id: 'node_abc',
      cpu: 4,
      memory_gib: 8,
      disk_gib: 20,
    })

    expect(dto.snapshot).toBe('ubuntu:24.04')
    expect(dto.name).toBe('sandbox-1')
    expect(dto.env).toEqual({ A: '1' })
    expect(dto.autoStopInterval).toBe(30)
    expect(dto.public).toBe(true)
    expect(dto.user).toBe('daytona')
    expect(dto.target).toBe('node_abc')
    // Daytona v1 allocates from the snapshot; explicit resources are not forwarded.
    expect(dto.cpu).toBeUndefined()
    expect(dto.memory).toBeUndefined()
    expect(dto.disk).toBeUndefined()
  })

  it('accepts camelCase aliases and the target alias', () => {
    const dto = buildCreateSandboxDto({
      snapshot: 'ubuntu:24.04',
      regionId: 'node_abc',
      autoStopMinutes: 5,
    })
    expect(dto.target).toBe('node_abc')
    expect(dto.autoStopInterval).toBe(5)
  })

  it('requires a snapshot', () => {
    expect(() => buildCreateSandboxDto({})).toThrow(BadRequestException)
  })

  it('rejects an invalid env payload', () => {
    expect(() =>
      buildCreateSandboxDto({ snapshot: 'ubuntu:24.04', env: { A: 1 } as any }),
    ).toThrow(BadRequestException)
  })
})

describe('mapSandboxState', () => {
  it.each([
    [SandboxState.CREATING, 'creating'],
    [SandboxState.PENDING_BUILD, 'creating'],
    [SandboxState.STARTING, 'starting'],
    [SandboxState.RESTORING, 'starting'],
    [SandboxState.STARTED, 'started'],
    [SandboxState.RESIZING, 'started'],
    [SandboxState.STOPPING, 'stopping'],
    [SandboxState.STOPPED, 'stopped'],
    [SandboxState.ARCHIVED, 'stopped'],
    [SandboxState.PAUSING, 'pausing'],
    [SandboxState.PAUSED, 'paused'],
    [SandboxState.DESTROYING, 'deleting'],
    [SandboxState.DESTROYED, 'deleted'],
    [SandboxState.ERROR, 'error'],
    [SandboxState.BUILD_FAILED, 'error'],
    ['not-a-state', 'error'],
  ])('maps %s to %s', (daytonaState, contractState) => {
    expect(mapSandboxState(daytonaState as SandboxState)).toBe(contractState)
  })
})
