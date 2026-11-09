/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { RunnerDto } from '../../sandbox/dto/runner.dto'
import { RunnerState } from '../../sandbox/enums/runner-state.enum'

/**
 * Aggregated node metrics used by the compute provider console.
 * Kept as a separate shape so the DB-backed metrics (7 day rollup, open alerts, RTT)
 * can be joined in without changing the public API contract.
 */
export interface ProviderNodeMetrics {
  rttMs: number | null
  sandboxStarts7d: number
  sandboxStartFailures7d: number
  avgStartupSeconds7d: number | null
  openAlertCount: number
}

export const EMPTY_PROVIDER_NODE_METRICS: ProviderNodeMetrics = {
  rttMs: null,
  sandboxStarts7d: 0,
  sandboxStartFailures7d: 0,
  avgStartupSeconds7d: null,
  openAlertCount: 0,
}

@ApiSchema({ name: 'ProviderNode' })
export class ProviderNodeDto {
  @ApiProperty({
    description: 'Unique identifier of the runner (compute node)',
    example: 'd4e5f6a7-1234-5678-90ab-cdef01234567',
  })
  runnerId: string

  @ApiProperty({
    description: 'Name of the runner (compute node)',
    example: 'my-laptop',
  })
  name: string

  @ApiProperty({
    description: 'Region the runner belongs to',
    example: 'us',
  })
  regionId: string

  @ApiProperty({
    description: 'Display name of the region the runner belongs to',
    example: 'us',
  })
  regionName: string

  @ApiProperty({
    description: 'Current state of the runner',
    enum: RunnerState,
    enumName: 'RunnerState',
    example: RunnerState.READY,
  })
  state: RunnerState

  @ApiProperty({
    description: 'Whether the node is accepting new sandboxes',
    example: false,
  })
  unschedulable: boolean

  @ApiPropertyOptional({
    description: 'Last time the control plane received a heartbeat from this node',
    example: '2026-11-09T12:30:00.000Z',
    nullable: true,
  })
  lastCheckedAt: string | null

  @ApiPropertyOptional({
    description: 'Round trip time of the last latency probe in milliseconds',
    example: 12.4,
    nullable: true,
  })
  rttMs: number | null

  @ApiProperty({ description: 'Total CPU cores available on the node', example: 8 })
  totalCpu: number

  @ApiProperty({ description: 'Total memory in GiB available on the node', example: 16 })
  totalMemoryGiB: number

  @ApiProperty({ description: 'Total disk in GiB available on the node', example: 100 })
  totalDiskGiB: number

  @ApiProperty({ description: 'Current CPU usage percentage', example: 45.5 })
  cpuUsagePct: number

  @ApiProperty({ description: 'Current memory usage percentage', example: 60.2 })
  memoryUsagePct: number

  @ApiProperty({ description: 'Current disk usage percentage', example: 35.8 })
  diskUsagePct: number

  @ApiProperty({ description: 'Currently allocated CPU cores', example: 4 })
  allocatedCpu: number

  @ApiProperty({ description: 'Currently allocated memory in GiB', example: 8 })
  allocatedMemoryGiB: number

  @ApiProperty({ description: 'Currently allocated disk in GiB', example: 50 })
  allocatedDiskGiB: number

  @ApiProperty({ description: 'Number of sandboxes currently running on the node', example: 2 })
  startedSandboxes: number

  @ApiProperty({ description: 'Scheduling availability score of the node', example: 9.2 })
  availabilityScore: number

  @ApiPropertyOptional({
    description: 'Runner application version',
    example: 'v0.190.0',
    nullable: true,
  })
  appVersion: string | null

  @ApiProperty({ description: 'Number of successful sandbox starts in the last 7 days', example: 120 })
  sandboxStarts7d: number

  @ApiProperty({ description: 'Number of failed sandbox starts in the last 7 days', example: 3 })
  sandboxStartFailures7d: number

  @ApiPropertyOptional({
    description: 'Average sandbox startup duration in seconds over the last 7 days',
    example: 8.4,
    nullable: true,
  })
  avgStartupSeconds7d: number | null

  @ApiProperty({ description: 'Number of unresolved alerts for this node', example: 1 })
  openAlertCount: number

  static fromRunner(
    runner: RunnerDto,
    regionName: string,
    metrics: ProviderNodeMetrics = EMPTY_PROVIDER_NODE_METRICS,
  ): ProviderNodeDto {
    return {
      runnerId: runner.id,
      name: runner.name,
      regionId: runner.region,
      regionName,
      state: runner.state,
      unschedulable: runner.unschedulable,
      lastCheckedAt: runner.lastChecked ?? null,
      rttMs: metrics.rttMs,
      totalCpu: runner.cpu,
      totalMemoryGiB: runner.memory,
      totalDiskGiB: runner.disk,
      cpuUsagePct: runner.currentCpuUsagePercentage,
      memoryUsagePct: runner.currentMemoryUsagePercentage,
      diskUsagePct: runner.currentDiskUsagePercentage,
      allocatedCpu: runner.currentAllocatedCpu,
      allocatedMemoryGiB: runner.currentAllocatedMemoryGiB,
      allocatedDiskGiB: runner.currentAllocatedDiskGiB,
      startedSandboxes: runner.currentStartedSandboxes,
      availabilityScore: runner.availabilityScore,
      appVersion: runner.appVersion ?? null,
      sandboxStarts7d: metrics.sandboxStarts7d,
      sandboxStartFailures7d: metrics.sandboxStartFailures7d,
      avgStartupSeconds7d: metrics.avgStartupSeconds7d,
      openAlertCount: metrics.openAlertCount,
    }
  }
}

@ApiSchema({ name: 'ProviderNodesResponse' })
export class ProviderNodesResponseDto {
  @ApiProperty({ description: 'Compute nodes owned by the organization', type: [ProviderNodeDto] })
  items: ProviderNodeDto[]
}
