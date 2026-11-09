/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

export enum MarketAlertType {
  LOW_BALANCE = 'low_balance',
  NEGATIVE_BALANCE = 'negative_balance',
  SLA_BREACH = 'sla_breach',
}

export enum MarketAlertSeverity {
  WARNING = 'warning',
  CRITICAL = 'critical',
}
