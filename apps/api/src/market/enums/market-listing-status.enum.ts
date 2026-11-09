/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

export enum MarketListingStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  PUBLISHED = 'published',
  PAUSED = 'paused',
  RETIRED = 'retired',
}

export enum MarketListingVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}
