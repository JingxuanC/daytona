/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

export interface PricedUsage {
  cpuHours: number
  memoryGiBHours: number
  diskGiBHours: number
  gpuHours: number
}

export interface HourlyPrice {
  cpuHourCents: number
  memoryGiBHourCents: number
  diskGiBHourCents: number
  gpuHourCents: number
}

/**
 * Converts billable usage into an amount expressed in integer cents.
 * We deliberately keep the result as an integer to avoid floating point drift in
 * settlement records; each line may round, the caller sums the rounded lines.
 */
export function computeAmountCents(usage: PricedUsage, pricing?: HourlyPrice | null): number {
  if (!pricing) {
    return 0
  }

  const amount =
    usage.cpuHours * pricing.cpuHourCents +
    usage.memoryGiBHours * pricing.memoryGiBHourCents +
    usage.diskGiBHours * pricing.diskGiBHourCents +
    usage.gpuHours * pricing.gpuHourCents

  return Math.round(amount)
}
