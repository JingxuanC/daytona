/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { PageContent, PageHeader, PageIntro, PageLayout } from '@/components/PageLayout'
import { MarketAccountTab } from '@/components/market/MarketAccountTab'
import { BidsTab } from '@/components/market/BidsTab'
import { MarketBrowseTab } from '@/components/market/MarketBrowseTab'
import { MarketUsageTab } from '@/components/market/MarketUsageTab'
import { MyLeasesTab } from '@/components/market/MyLeasesTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { OrganizationRolePermissionsEnum } from '@daytona/api-client'
import React, { useMemo, useState } from 'react'

type ComputeMarketTab = 'browse' | 'bids' | 'leases' | 'usage' | 'account'

const ComputeMarket: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ComputeMarketTab>('browse')
  const { authenticatedUserHasPermission } = useSelectedOrganization()

  const writePermitted = useMemo(
    () => authenticatedUserHasPermission(OrganizationRolePermissionsEnum.WRITE_SANDBOXES),
    [authenticatedUserHasPermission],
  )

  return (
    <PageLayout>
      <PageHeader />

      <PageContent size="full">
        <PageIntro title="算力市场" desc="浏览平台上的算力供给，按需租用后即可在创建沙箱时选择对应 region。" />

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ComputeMarketTab)} className="flex-1">
          <TabsList variant="underline">
            <TabsTrigger value="browse">浏览算力</TabsTrigger>
            <TabsTrigger value="bids">竞价</TabsTrigger>
            <TabsTrigger value="leases">我的租用</TabsTrigger>
            <TabsTrigger value="usage">我的用量</TabsTrigger>
            <TabsTrigger value="account">账户</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="flex flex-col gap-3 pt-3">
            <MarketBrowseTab writePermitted={writePermitted} />
          </TabsContent>
          <TabsContent value="bids" className="flex flex-col gap-3 pt-3">
            <BidsTab writePermitted={writePermitted} />
          </TabsContent>
          <TabsContent value="leases" className="flex flex-col gap-3 pt-3">
            <MyLeasesTab writePermitted={writePermitted} />
          </TabsContent>
          <TabsContent value="usage" className="flex flex-col gap-3 pt-3">
            <MarketUsageTab />
          </TabsContent>
          <TabsContent value="account" className="flex flex-col gap-3 pt-3">
            <MarketAccountTab />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageLayout>
  )
}

export default ComputeMarket
