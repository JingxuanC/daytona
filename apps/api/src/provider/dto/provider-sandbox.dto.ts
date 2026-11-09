/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { Sandbox } from '../../sandbox/entities/sandbox.entity'
import { SandboxState } from '../../sandbox/enums/sandbox-state.enum'

@ApiSchema({ name: 'ProviderSandbox' })
export class ProviderSandboxDto {
  @ApiProperty({ description: 'Unique identifier of the sandbox', example: 'sbx-1234' })
  sandboxId: string

  @ApiProperty({ description: 'Name of the sandbox', example: 'my-sandbox' })
  name: string

  @ApiProperty({
    description: 'Current state of the sandbox',
    enum: SandboxState,
    enumName: 'SandboxState',
    example: SandboxState.STARTED,
  })
  state: SandboxState

  @ApiProperty({ description: 'CPU cores allocated to the sandbox', example: 2 })
  cpu: number

  @ApiProperty({ description: 'Memory allocated to the sandbox in GiB', example: 4 })
  memoryGiB: number

  @ApiProperty({ description: 'Disk allocated to the sandbox in GiB', example: 10 })
  diskGiB: number

  @ApiProperty({ description: 'Creation timestamp of the sandbox', example: '2026-11-09T12:00:00.000Z' })
  createdAt: string

  @ApiPropertyOptional({
    description: 'Timestamp the sandbox was last started',
    example: '2026-11-09T12:01:00.000Z',
    nullable: true,
  })
  startedAt: string | null

  static fromSandbox(sandbox: Sandbox): ProviderSandboxDto {
    return {
      sandboxId: sandbox.id,
      name: sandbox.name,
      state: sandbox.state,
      cpu: sandbox.cpu,
      memoryGiB: sandbox.mem,
      diskGiB: sandbox.disk,
      createdAt: sandbox.createdAt?.toISOString(),
      startedAt: null,
    }
  }
}

@ApiSchema({ name: 'ProviderSandboxesResponse' })
export class ProviderSandboxesResponseDto {
  @ApiProperty({ description: 'Sandboxes currently assigned to the node', type: [ProviderSandboxDto] })
  items: ProviderSandboxDto[]
}
