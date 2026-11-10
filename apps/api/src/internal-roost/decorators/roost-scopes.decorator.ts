/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { SetMetadata } from '@nestjs/common'
import { RoostScope } from '../enums/roost-scope.enum'
import { ROOST_METADATA_SCOPES_KEY } from '../internal-roost.constants'

/**
 * Requires the callers credential to carry every listed scope.
 *
 * Enforced by `RoostScopeGuard` (control plane) and `RoostDataPlaneGuard` (data plane).
 */
export const RoostScopes = (...scopes: RoostScope[]) => SetMetadata(ROOST_METADATA_SCOPES_KEY, scopes)
