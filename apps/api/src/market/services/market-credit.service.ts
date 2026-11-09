/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { DEFAULT_PRICING_CURRENCY } from '../../provider/entities/runner-pricing.entity'
import { MarketCreditEntry } from '../entities/market-credit-entry.entity'
import { MarketCreditEntryType } from '../enums/market-credit-entry-type.enum'

export interface MarketBalance {
  balanceCents: number
  currency: string
}

/**
 * Append-only credit ledger for market consumption.
 *
 * Self-hosted M2 runs a single API instance; per-organization ordering is
 * serialized in-process so `balanceAfterCents` stays consistent. The
 * (organizationId, referenceId) unique index keeps usage charges idempotent
 * even if the job runs twice.
 */
@Injectable()
export class MarketCreditService {
  private static readonly orgLocks = new Map<string, Promise<unknown>>()

  constructor(
    @InjectRepository(MarketCreditEntry)
    private readonly entryRepository: Repository<MarketCreditEntry>,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(organizationId: string): Promise<MarketBalance> {
    const latest = await this.entryRepository.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    })
    return {
      balanceCents: latest?.balanceAfterCents ?? 0,
      currency: latest?.currency ?? DEFAULT_PRICING_CURRENCY,
    }
  }

  async listEntries(organizationId: string, limit = 50): Promise<MarketCreditEntry[]> {
    return this.entryRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    })
  }

  async topUp(organizationId: string, amountCents: number, description?: string): Promise<MarketCreditEntry> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error('Top-up amount must be a positive integer number of cents')
    }
    return this.withOrgLock(organizationId, () =>
      this.dataSource.transaction((manager) =>
        this.append(manager, {
          organizationId,
          type: MarketCreditEntryType.TOPUP,
          signedAmountCents: amountCents,
          description: description ?? 'Manual market credit top-up',
          referenceType: 'manual',
        }),
      ),
    )
  }

  /**
   * Charges a consumer for market usage. `amountCents` is positive; the ledger stores it negative.
   * Idempotent per (organizationId, referenceId) when referenceType is `market_usage`.
   */
  async chargeUsage(
    organizationId: string,
    amountCents: number,
    referenceId: string,
    description?: string,
  ): Promise<MarketCreditEntry | null> {
    if (amountCents <= 0) {
      return null
    }
    return this.withOrgLock(organizationId, () =>
      this.dataSource.transaction(async (manager) => {
        const existing = await manager.getRepository(MarketCreditEntry).findOne({
          where: { organizationId, referenceType: 'market_usage', referenceId },
        })
        if (existing) {
          return null
        }
        return this.append(manager, {
          organizationId,
          type: MarketCreditEntryType.CHARGE,
          signedAmountCents: -amountCents,
          description: description ?? 'Market usage charge',
          referenceType: 'market_usage',
          referenceId,
        })
      }),
    )
  }

  /**
   * Appends a ledger row inside an existing transaction (used by the charging job so the
   * charge record and the ledger move together).
   */
  async appendWithinManager(
    manager: EntityManager,
    params: {
      organizationId: string
      type: MarketCreditEntryType
      signedAmountCents: number
      description?: string
      referenceType?: string
      referenceId?: string
    },
  ): Promise<MarketCreditEntry> {
    return this.append(manager, params)
  }

  /**
   * Organizations whose latest balance is below `thresholdCents` (risk control).
   * Returns a bounded page of organizations.
   */
  async getBalancesBelow(
    thresholdCents: number,
    limit = 200,
  ): Promise<Array<{ organizationId: string; balanceCents: number }>> {
    const rows: Array<{ organizationId: string; balanceAfterCents: number | string }> = await this.dataSource.query(
      `SELECT DISTINCT ON ("organizationId") "organizationId", "balanceAfterCents"
       FROM "market_credit_entries"
       ORDER BY "organizationId", "createdAt" DESC`,
    )
    return rows
      .map((row) => ({ organizationId: row.organizationId, balanceCents: Number(row.balanceAfterCents) }))
      .filter((row) => row.balanceCents < thresholdCents)
      .slice(0, limit)
  }

  /** Organizations with a negative market balance (operations view). */
  async getNegativeBalances(limit = 20): Promise<Array<{ organizationId: string; balanceCents: number }>> {
    const rows: Array<{ organizationId: string; balanceAfterCents: number | string }> = await this.dataSource.query(
      `SELECT DISTINCT ON ("organizationId") "organizationId", "balanceAfterCents"
       FROM "market_credit_entries"
       ORDER BY "organizationId", "createdAt" DESC`,
    )
    return rows
      .map((row) => ({ organizationId: row.organizationId, balanceCents: Number(row.balanceAfterCents) }))
      .filter((row) => row.balanceCents < 0)
      .slice(0, limit)
  }

  /** Credits a consumer for an SLA breach (platform-funded in M4). */
  async compensate(
    organizationId: string,
    amountCents: number,
    referenceId: string,
    description?: string,
  ): Promise<MarketCreditEntry | null> {
    if (amountCents <= 0) {
      return null
    }
    return this.withOrgLock(organizationId, () =>
      this.dataSource.transaction(async (manager) => {
        const existing = await manager.getRepository(MarketCreditEntry).findOne({
          where: { organizationId, referenceType: 'sla_compensation', referenceId },
        })
        if (existing) {
          return null
        }
        return this.append(manager, {
          organizationId,
          type: MarketCreditEntryType.REFUND,
          signedAmountCents: amountCents,
          description: description ?? 'SLA compensation',
          referenceType: 'sla_compensation',
          referenceId,
        })
      }),
    )
  }

  async hasUsageCharge(organizationId: string, referenceId: string): Promise<boolean> {
    const existing = await this.entryRepository.findOne({
      where: { organizationId, referenceType: 'market_usage', referenceId },
    })
    return Boolean(existing)
  }

  private async withOrgLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    const previous = MarketCreditService.orgLocks.get(organizationId) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    const tail = run.catch(() => undefined)
    MarketCreditService.orgLocks.set(organizationId, tail)
    try {
      return await run
    } finally {
      if (MarketCreditService.orgLocks.get(organizationId) === tail) {
        MarketCreditService.orgLocks.delete(organizationId)
      }
    }
  }

  private async append(
    manager: EntityManager,
    params: {
      organizationId: string
      type: MarketCreditEntryType
      signedAmountCents: number
      description?: string
      referenceType?: string
      referenceId?: string
    },
  ): Promise<MarketCreditEntry> {
    const repository = manager.getRepository(MarketCreditEntry)
    const latest = await repository.findOne({
      where: { organizationId: params.organizationId },
      order: { createdAt: 'DESC' },
    })
    const currency = latest?.currency ?? DEFAULT_PRICING_CURRENCY
    const balanceAfterCents = (latest?.balanceAfterCents ?? 0) + params.signedAmountCents

    const entry = repository.create({
      organizationId: params.organizationId,
      type: params.type,
      amountCents: params.signedAmountCents,
      balanceAfterCents,
      currency,
      description: params.description ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
    })
    return repository.save(entry)
  }
}
