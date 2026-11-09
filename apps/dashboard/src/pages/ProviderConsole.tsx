/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { PageContent, PageHeader, PageIntro, PageLayout } from '@/components/PageLayout'
import { AlertsTab } from '@/components/provider-console/AlertsTab'
import { EarningsTab } from '@/components/provider-console/EarningsTab'
import { NodeStatusTab } from '@/components/provider-console/NodeStatusTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { OrganizationRolePermissionsEnum, OrganizationUserRoleEnum } from '@daytona/api-client'
import React, { useMemo, useState } from 'react'

type ProviderConsoleTab = 'nodes' | 'earnings' | 'alerts'

const ProviderConsole: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ProviderConsoleTab>('nodes')
  const { authenticatedUserHasPermission, authenticatedUserOrganizationMember } = useSelectedOrganization()

  const writePermitted = useMemo(
    () => authenticatedUserHasPermission(OrganizationRolePermissionsEnum.WRITE_RUNNERS),
    [authenticatedUserHasPermission],
  )

  const isOwner = authenticatedUserOrganizationMember?.role === OrganizationUserRoleEnum.OWNER

  return (
    <PageLayout>
      <PageHeader />

      <PageContent size="full">
        <PageIntro title="算力控制台" desc="查看节点运行状态、用量收益与结算告警。" />

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ProviderConsoleTab)}
          className="flex-1"
        >
          <TabsList variant="underline">
            <TabsTrigger value="nodes">节点</TabsTrigger>
            <TabsTrigger value="earnings">收益</TabsTrigger>
            <TabsTrigger value="alerts">告警</TabsTrigger>
          </TabsList>

          <TabsContent value="nodes" className="flex flex-col gap-3 pt-3">
            <NodeStatusTab />
          </TabsContent>
          <TabsContent value="earnings" className="flex flex-col gap-3 pt-3">
            <EarningsTab writePermitted={writePermitted} isOwner={isOwner} />
          </TabsContent>
          <TabsContent value="alerts" className="flex flex-col gap-3 pt-3">
            <AlertsTab writePermitted={writePermitted} />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageLayout>
  )
}

export default ProviderConsole
