/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { useContext, useEffect, useState } from 'react'
import { PostHogContext } from 'posthog-js/react'
import { useConfig } from '@/hooks/useConfig'
import { FeatureFlags } from '@/enums/FeatureFlags'

/**
 * Feature flag check with a self-hosted fallback.
 *
 * The hosted platform evaluates flags through PostHog. Self-hosted
 * deployments typically run without a PostHog project configured; in that
 * case feature-gated functionality (custom regions, runners, ...) is
 * always enabled instead of being permanently hidden.
 */
export function useFeatureFlag(flag: FeatureFlags): boolean {
  const config = useConfig()
  const posthog = useContext(PostHogContext)?.client
  const [flagEnabled, setFlagEnabled] = useState<boolean>(false)

  useEffect(() => {
    if (!posthog) {
      return
    }
    setFlagEnabled(posthog.isFeatureEnabled(flag) ?? false)
    return posthog.onFeatureFlags(() => {
      setFlagEnabled(posthog.isFeatureEnabled(flag) ?? false)
    })
  }, [posthog, flag])

  if (!config.posthog?.apiKey || !posthog) {
    return true
  }

  return flagEnabled
}
