/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'
import {
  buildCreateSandboxDto,
  buildCreateSandboxSnapshotDto,
  buildResizeSandboxDto,
  mapSandboxState,
  RoostSandboxesService,
} from './roost-sandboxes.service'

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
    pause: jest.fn(async (...args: any[]) => {
      const [, organization] = args
      if (organization?.id !== ORG.id) {
        throw new NotFoundException(`Sandbox with ID or name sbx-1 not found`)
      }
      return { id: 'sbx-1', state: SandboxState.PAUSED, organizationId: ORG.id }
    }),
    resize: jest.fn(async (...args: any[]) => {
      const [, , organization] = args
      if (organization?.id !== ORG.id) {
        throw new NotFoundException(`Sandbox with ID or name sbx-1 not found`)
      }
      return { id: 'sbx-1', state: SandboxState.RESIZING, organizationId: ORG.id }
    }),
    createSnapshotFromSandbox: jest.fn(async (...args: any[]) => {
      const [, organization] = args
      if (organization?.id !== ORG.id) {
        throw new NotFoundException(`Sandbox with ID or name sbx-1 not found`)
      }
      return { id: 'sbx-1', state: SandboxState.SNAPSHOTTING, organizationId: ORG.id }
    }),
  }
  const organizationService = {
    findOne: jest.fn(async (id: string) => (id === ORG.id ? ORG : { ...ORG, id })),
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

describe('RoostSandboxesService § optional M1 operations', () => {
  describe('pause', () => {
    it('pauses through SandboxService with the organization from the credential', async () => {
      const { service, sandboxService } = createService()

      const result = await service.pauseSandbox('org-jwt', 'sbx-1')

      expect(sandboxService.pause).toHaveBeenCalledWith('sbx-1', ORG)
      expect(result).toEqual({ id: 'sbx-1', state: 'paused', organization_id: 'org-jwt' })
    })

    it('rejects request body fields (including organizationId) for pause', async () => {
      const { service, sandboxService } = createService()

      await expect(
        service.pauseSandbox('org-jwt', 'sbx-1', { organizationId: 'other-org' }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/Unsupported field\(s\) for pause: organizationId/) })
      expect(sandboxService.pause).not.toHaveBeenCalled()
    })

    it('returns 404 for a sandbox of another organization (service scoping)', async () => {
      const { service } = createService()

      await expect(service.pauseSandbox('org-other', 'sbx-1')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('resize', () => {
    it('resizes with the fork-supported fields (cpu/memory/disk)', async () => {
      const { service, sandboxService } = createService()

      const result = await service.resizeSandbox('org-jwt', 'sbx-1', { cpu: 2, memory: 4, disk: 20 })

      expect(sandboxService.resize).toHaveBeenCalledTimes(1)
      const [sandboxId, resizeDto, organization] = sandboxService.resize.mock.calls[0]
      expect(sandboxId).toBe('sbx-1')
      expect(resizeDto).toMatchObject({ cpu: 2, memory: 4, disk: 20 })
      expect(organization).toBe(ORG)
      expect(result).toEqual({ id: 'sbx-1', state: 'started', organization_id: 'org-jwt' })
    })

    it('rejects unsupported fields and names the supported ones', async () => {
      const { service, sandboxService } = createService()

      await expect(
        service.resizeSandbox('org-jwt', 'sbx-1', { cpu: 2, gpu: 1 } as any),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /Unsupported field\(s\) for resize: gpu\. Supported fields for resize: cpu, memory, disk/,
        ),
      })
      expect(sandboxService.resize).not.toHaveBeenCalled()
    })

    it('rejects organizationId in the body', async () => {
      const { service } = createService()
      await expect(
        service.resizeSandbox('org-jwt', 'sbx-1', { cpu: 2, organizationId: 'other-org' } as any),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('requires at least one resource field', async () => {
      const { service } = createService()
      await expect(service.resizeSandbox('org-jwt', 'sbx-1', {})).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects invalid resource values', async () => {
      const { service } = createService()
      await expect(service.resizeSandbox('org-jwt', 'sbx-1', { cpu: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      await expect(service.resizeSandbox('org-jwt', 'sbx-1', { memory: '4' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('returns 404 for a sandbox of another organization (service scoping)', async () => {
      const { service } = createService()
      await expect(service.resizeSandbox('org-other', 'sbx-1', { cpu: 2 })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  describe('snapshot', () => {
    it('creates a snapshot with the fork-supported fields and echoes the name', async () => {
      const { service, sandboxService } = createService()

      const result = await service.snapshotSandbox('org-jwt', 'sbx-1', { name: 'snap-1' })

      expect(sandboxService.createSnapshotFromSandbox).toHaveBeenCalledTimes(1)
      const [sandboxId, organization, snapshotDto] = sandboxService.createSnapshotFromSandbox.mock.calls[0]
      expect(sandboxId).toBe('sbx-1')
      expect(organization).toBe(ORG)
      expect(snapshotDto).toMatchObject({ name: 'snap-1' })
      expect(result).toEqual({
        id: 'sbx-1',
        state: 'started',
        organization_id: 'org-jwt',
        snapshot_name: 'snap-1',
      })
    })

    it('accepts the include_memory snake_case alias', async () => {
      const { service, sandboxService } = createService()
      await service.snapshotSandbox('org-jwt', 'sbx-1', { name: 'snap-1', include_memory: true })
      const [, , snapshotDto] = sandboxService.createSnapshotFromSandbox.mock.calls[0]
      expect(snapshotDto.includeMemory).toBe(true)
    })

    it('requires a name', async () => {
      const { service } = createService()
      await expect(service.snapshotSandbox('org-jwt', 'sbx-1', {})).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects unsupported fields and names the supported ones', async () => {
      const { service, sandboxService } = createService()

      await expect(
        service.snapshotSandbox('org-jwt', 'sbx-1', { name: 'snap-1', snapshot: 'ubuntu' } as any),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /Unsupported field\(s\) for snapshot: snapshot\. Supported fields for snapshot: name, includeMemory, include_memory/,
        ),
      })
      expect(sandboxService.createSnapshotFromSandbox).not.toHaveBeenCalled()
    })

    it('rejects unsafe names', async () => {
      const { service } = createService()
      await expect(
        service.snapshotSandbox('org-jwt', 'sbx-1', { name: '<script>alert(1)</script>' }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('returns 404 for a sandbox of another organization (service scoping)', async () => {
      const { service } = createService()
      await expect(service.snapshotSandbox('org-other', 'sbx-1', { name: 'snap-1' })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })
})

describe('buildResizeSandboxDto', () => {
  it('builds the fork ResizeSandboxDto', () => {
    const dto = buildResizeSandboxDto({ cpu: 2, memory: 4 })
    expect(dto).toBeInstanceOf(Object)
    expect(dto.cpu).toBe(2)
    expect(dto.memory).toBe(4)
    expect(dto.disk).toBeUndefined()
  })
})

describe('buildCreateSandboxSnapshotDto', () => {
  it('builds the fork CreateSandboxSnapshotDto and trims the name', () => {
    const dto = buildCreateSandboxSnapshotDto({ name: '  snap-1  ', includeMemory: true })
    expect(dto.name).toBe('snap-1')
    expect(dto.includeMemory).toBe(true)
  })

  it('rejects conflicting includeMemory/include_memory values', () => {
    expect(() =>
      buildCreateSandboxSnapshotDto({ name: 'snap-1', includeMemory: true, include_memory: false }),
    ).toThrow(BadRequestException)
  })

  it('rejects a non-boolean includeMemory', () => {
    expect(() => buildCreateSandboxSnapshotDto({ name: 'snap-1', includeMemory: 'yes' as any })).toThrow(
      BadRequestException,
    )
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
