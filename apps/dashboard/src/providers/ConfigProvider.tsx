/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { RoutePath } from '@/enums/RoutePath'
import { queryKeys } from '@/hooks/queries/queryKeys'
import { DaytonaConfiguration } from '@daytona/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts'
import { ReactNode, useMemo } from 'react'
import { AuthProvider, AuthProviderProps } from 'react-oidc-context'
import { ConfigContext } from '../contexts/ConfigContext'

const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin + '/api'

type Props = {
  children: ReactNode
}

export function ConfigProvider(props: Props) {
  const { data: config } = useSuspenseQuery({
    queryKey: queryKeys.config.all,
    queryFn: async () => {
      const res = await fetch(`${apiUrl}/config`)
      if (!res.ok) {
        throw res
      }
      return res.json() as Promise<DaytonaConfiguration>
    },
  })

  const oidcConfig: AuthProviderProps = useMemo(() => {
    // 自托管常见入口是 127.0.0.1 / ::1；只把字面量 localhost 当作本地会让登录态
    // 落到 InMemoryWebStorage，任何整页跳转/刷新都会丢登录态（被踢回 Dex 登录页）。
    const localHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    const isLocalhost = localHostnames.has(window.location.hostname)
    const stateStore = isLocalhost ? window.sessionStorage : new InMemoryWebStorage()

    return {
      authority: config.oidc.issuer,
      client_id: config.oidc.clientId,
      extraQueryParams: {
        audience: config.oidc.audience,
      },
      scope: 'openid profile email',
      redirect_uri: window.location.origin + '/dashboard',
      staleStateAgeInSeconds: 60,
      accessTokenExpiringNotificationTimeInSeconds: 290,
      userStore: new WebStorageStateStore({ store: stateStore }),
      onSigninCallback: (user) => {
        const state = user?.state as { returnTo?: string } | undefined
        const targetUrl = state?.returnTo || RoutePath.DASHBOARD
        window.history.replaceState({}, '', targetUrl)
        window.dispatchEvent(new PopStateEvent('popstate'))
      },
      post_logout_redirect_uri: window.location.origin + '/dashboard',
    }
  }, [config])

  return (
    <ConfigContext.Provider value={{ ...config, apiUrl }}>
      <AuthProvider {...oidcConfig}>{props.children}</AuthProvider>
    </ConfigContext.Provider>
  )
}
