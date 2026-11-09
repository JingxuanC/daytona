/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { platformFeeBpsFromEnv } from '../../common/utils/platform-fee'
import { MarketSetting } from '../entities/market-setting.entity'

const PLATFORM_FEE_KEY = 'platformFeeBps'

@Injectable()
export class MarketSettingsService {
  constructor(
    @InjectRepository(MarketSetting)
    private readonly settingRepository: Repository<MarketSetting>,
  ) {}

  /**
   * Platform commission in basis points. A persisted runtime value wins over
   * `MARKET_PLATFORM_FEE_BPS` so operators can tune it without a restart.
   */
  async getPlatformFeeBps(): Promise<number> {
    const setting = await this.settingRepository.findOne({ where: { key: PLATFORM_FEE_KEY } })
    if (!setting) {
      return platformFeeBpsFromEnv()
    }
    const parsed = Number(setting.value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
      return platformFeeBpsFromEnv()
    }
    return Math.floor(parsed)
  }

  async setPlatformFeeBps(platformFeeBps: number): Promise<number> {
    if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
      throw new BadRequestException('platformFeeBps must be an integer between 0 and 10000')
    }
    await this.settingRepository.upsert({ key: PLATFORM_FEE_KEY, value: String(platformFeeBps) }, ['key'])
    return platformFeeBps
  }
}
