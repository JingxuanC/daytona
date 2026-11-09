/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

@ApiSchema({ name: 'UpsertProviderPricing' })
export class UpsertProviderPricingDto {
  @ApiProperty({ description: 'Price per vCPU hour, in integer cents', example: 10 })
  @IsInt()
  @Min(0)
  cpuHourCents: number

  @ApiProperty({ description: 'Price per GiB memory hour, in integer cents', example: 2 })
  @IsInt()
  @Min(0)
  memoryGiBHourCents: number

  @ApiProperty({ description: 'Price per GiB disk hour, in integer cents', example: 1 })
  @IsInt()
  @Min(0)
  diskGiBHourCents: number

  @ApiProperty({ description: 'Price per GPU hour, in integer cents', example: 500 })
  @IsInt()
  @Min(0)
  gpuHourCents: number

  @ApiPropertyOptional({
    description: 'Currency of the prices (ISO 4217)',
    example: 'CNY',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string
}

@ApiSchema({ name: 'ProviderPricingItem' })
export class ProviderPricingItemDto {
  @ApiProperty({ description: 'Runner (compute node) ID', example: 'd4e5f6a7-1234-5678-90ab-cdef01234567' })
  runnerId: string

  @ApiProperty({ description: 'Display name of the runner', example: 'my-laptop' })
  runnerName: string

  @ApiProperty({ description: 'Price per vCPU hour, in integer cents', example: 10 })
  cpuHourCents: number

  @ApiProperty({ description: 'Price per GiB memory hour, in integer cents', example: 2 })
  memoryGiBHourCents: number

  @ApiProperty({ description: 'Price per GiB disk hour, in integer cents', example: 1 })
  diskGiBHourCents: number

  @ApiProperty({ description: 'Price per GPU hour, in integer cents', example: 500 })
  gpuHourCents: number

  @ApiPropertyOptional({
    description: 'Last time the pricing was updated',
    example: '2026-11-09T12:00:00.000Z',
    nullable: true,
  })
  updatedAt: string | null
}

@ApiSchema({ name: 'ProviderPricingResponse' })
export class ProviderPricingResponseDto {
  @ApiProperty({ description: 'Currency of the prices', example: 'CNY' })
  currency: string

  @ApiProperty({ description: 'Pricing per compute node', type: [ProviderPricingItemDto] })
  items: ProviderPricingItemDto[]
}
