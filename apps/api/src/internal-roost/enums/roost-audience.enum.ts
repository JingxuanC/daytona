/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/**
 * Audience of a short-lived Roost credential.
 *
 * - `daytona-control`: control-plane operations (regions, runners, quotas, sandboxes, usage).
 * - `daytona-data`: data-plane proxying for exactly one sandbox (toolbox/preview).
 */
export enum RoostAudience {
  CONTROL = 'daytona-control',
  DATA = 'daytona-data',
}

export const ROOST_AUDIENCES: string[] = Object.values(RoostAudience)
