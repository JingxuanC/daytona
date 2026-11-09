/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { FindOperator } from 'typeorm'

/**
 * Minimal in-memory replacement for a TypeORM repository, used by provider console
 * acceptance specs that should not require a database.
 */
export class InMemoryRepository<T extends Record<string, any>> {
  rows: T[]
  private sequence = 0

  constructor(rows: T[] = []) {
    this.rows = rows.map((row) => ({ ...row }))
  }

  create(data: Partial<T>): T {
    return { ...data } as T
  }

  async save(entity: T | T[]): Promise<any> {
    if (Array.isArray(entity)) {
      const saved: T[] = []
      for (const item of entity) {
        saved.push(await this.saveEntity(item))
      }
      return saved
    }
    return this.saveEntity(entity)
  }

  async find(options?: { where?: any; order?: any; take?: number }): Promise<T[]> {
    const where = options?.where
    // TypeORM allows an array of where conditions (OR). Test helpers used by provider specs
    // rely on that for runner-attributed usage queries.
    let result = this.rows.filter((row) =>
      Array.isArray(where) ? where.some((condition) => matchesWhere(row, condition)) : matchesWhere(row, where),
    )
    if (options?.take !== undefined) {
      result = result.slice(0, options.take)
    }
    return result.map((row) => ({ ...row }))
  }

  async findOne(options: { where: any }): Promise<T | null> {
    const row = this.rows.find((candidate) => matchesWhere(candidate, options.where))
    return row ? ({ ...row } as T) : null
  }

  async findOneBy(where: any): Promise<T | null> {
    return this.findOne({ where })
  }

  async delete(criteria: any): Promise<{ affected: number }> {
    const before = this.rows.length
    this.rows = this.rows.filter((row) => !matchesWhere(row, criteria))
    return { affected: before - this.rows.length }
  }

  async update(criteria: any, partial: Partial<T>): Promise<{ affected: number }> {
    let affected = 0
    for (const row of this.rows) {
      if (matchesWhere(row, criteria)) {
        Object.assign(row, partial)
        affected++
      }
    }
    return { affected }
  }

  async increment(criteria: any, property: string, value: number): Promise<{ affected: number }> {
    let affected = 0
    for (const row of this.rows) {
      if (matchesWhere(row, criteria)) {
        const mutableRow = row as Record<string, any>
        mutableRow[property] = ((mutableRow[property] as number) ?? 0) + value
        affected++
      }
    }
    return { affected }
  }

  clean(): void {
    this.rows = []
  }

  private async saveEntity(entity: T): Promise<T> {
    const record = entity as Record<string, any>
    if (!record.id) {
      this.sequence++
      record.id = `fake-id-${this.sequence}`
    }
    // Simulate @CreateDateColumn / @UpdateDateColumn defaults of the real database
    if (!record.createdAt) {
      record.createdAt = new Date()
    }
    record.updatedAt = new Date()

    const index = this.rows.findIndex((row) => row.id === record.id)
    if (index >= 0) {
      this.rows[index] = entity
    } else {
      this.rows.push(entity)
    }
    return entity
  }
}

export function matchesWhere(row: Record<string, any>, where: any): boolean {
  if (!where) {
    return true
  }

  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) {
      return true
    }

    const actual = row[key]

    if (expected instanceof FindOperator) {
      return matchesOperator(actual, expected as FindOperator<unknown>)
    }

    if (expected !== null && typeof expected === 'object' && 'type' in expected && 'value' in expected) {
      return matchesOperator(actual, expected as FindOperator<unknown>)
    }

    if (Array.isArray(expected)) {
      return expected.includes(actual)
    }

    return actual === expected
  })
}

function matchesOperator(value: unknown, operator: FindOperator<unknown>): boolean {
  switch (operator.type) {
    case 'isNull':
      return value === null || value === undefined
    case 'not': {
      const inner = operator.value
      if (inner instanceof FindOperator) {
        return !matchesOperator(value, inner as FindOperator<unknown>)
      }
      return value !== inner
    }
    case 'lessThan':
      return (value as any) < (operator.value as any)
    case 'lessThanOrEqual':
      return (value as any) <= (operator.value as any)
    case 'moreThan':
      return (value as any) > (operator.value as any)
    case 'moreThanOrEqual':
      return (value as any) >= (operator.value as any)
    case 'between': {
      const [min, max] = operator.value as [any, any]
      return (value as any) >= min && (value as any) <= max
    }
    case 'in':
      return (operator.value as unknown[]).includes(value)
    default:
      return true
  }
}

export function makeUsagePeriod(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: `period-${Math.random().toString(36).slice(2, 10)}`,
    sandboxId: 'sandbox-1',
    organizationId: 'org-1',
    startAt: new Date('2026-11-08T00:00:00.000Z'),
    endAt: new Date('2026-11-09T00:00:00.000Z'),
    cpu: 1,
    gpu: 0,
    gpuType: null,
    mem: 2,
    disk: 3,
    region: 'region-1',
    runnerId: 'runner-1',
    sandboxClass: 'container',
    regionType: 'custom',
    ...overrides,
  }
}

export function makePricing(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'pricing-1',
    organizationId: 'org-1',
    runnerId: 'runner-1',
    cpuHourCents: 10,
    memoryGiBHourCents: 2,
    diskGiBHourCents: 1,
    gpuHourCents: 0,
    currency: 'CNY',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  }
}
