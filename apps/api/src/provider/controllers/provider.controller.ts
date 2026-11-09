/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOAuth2, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { CustomHeaders } from '../../common/constants/header.constants'
import { IsOrganizationAuthContext } from '../../common/decorators/auth-context.decorator'
import { OrganizationAuthContext } from '../../common/interfaces/organization-auth-context.interface'
import { RequiredOrganizationResourcePermissions } from '../../organization/decorators/required-organization-resource-permissions.decorator'
import { OrganizationMemberRole } from '../../organization/enums/organization-member-role.enum'
import { OrganizationResourcePermission } from '../../organization/enums/organization-resource-permission.enum'
import { OrganizationAuthContextGuard } from '../../organization/guards/organization-auth-context.guard'
import { ProviderEarningsQueryDto, ProviderEarningsResponseDto } from '../dto/provider-earnings.dto'
import { ProviderAlertItemDto, ProviderAlertsQueryDto, ProviderAlertsResponseDto } from '../dto/provider-alert.dto'
import { ProviderNodeDto, ProviderNodesResponseDto } from '../dto/provider-node.dto'
import {
  ProviderPricingItemDto,
  ProviderPricingResponseDto,
  UpsertProviderPricingDto,
} from '../dto/provider-pricing.dto'
import { ProviderSandboxesResponseDto } from '../dto/provider-sandbox.dto'
import {
  ProviderSettlementDetailDto,
  ProviderSettlementItemDto,
  ProviderSettlementsQueryDto,
  ProviderSettlementsResponseDto,
  UpdateProviderSettlementStatusDto,
} from '../dto/provider-settlement.dto'
import { ProviderUsageQueryDto, ProviderUsageResponseDto } from '../dto/provider-usage.dto'
import { ProviderEarningsService } from '../services/provider-earnings.service'
import { ProviderAlertsService } from '../services/provider-alerts.service'
import { ProviderNodesService } from '../services/provider-nodes.service'
import { ProviderPricingService } from '../services/provider-pricing.service'
import { ProviderSettlementService } from '../services/provider-settlement.service'
import { ProviderUsageService } from '../services/provider-usage.service'

@Controller('provider')
@ApiTags('provider')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@ApiHeader(CustomHeaders.ORGANIZATION_ID)
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@UseGuards(AuthenticatedRateLimitGuard)
@UseGuards(OrganizationAuthContextGuard)
export class ProviderController {
  constructor(
    private readonly providerNodesService: ProviderNodesService,
    private readonly providerUsageService: ProviderUsageService,
    private readonly providerPricingService: ProviderPricingService,
    private readonly providerEarningsService: ProviderEarningsService,
    private readonly providerSettlementService: ProviderSettlementService,
    private readonly providerAlertsService: ProviderAlertsService,
  ) {}

  @Get('nodes')
  @ApiOperation({
    summary: 'List compute nodes owned by the organization',
    operationId: 'listProviderNodes',
    description:
      'Returns every runner (compute node) owned by the organization with its current state, resource usage and latest heartbeat.',
  })
  @ApiResponse({
    status: 200,
    type: ProviderNodesResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listNodes(@IsOrganizationAuthContext() authContext: OrganizationAuthContext): Promise<ProviderNodesResponseDto> {
    const items = await this.providerNodesService.listNodes(authContext.organizationId)
    return { items }
  }

  @Get('nodes/:runnerId/sandboxes')
  @ApiOperation({
    summary: 'List sandboxes running on a compute node of the organization',
    operationId: 'listProviderNodeSandboxes',
  })
  @ApiParam({
    name: 'runnerId',
    description: 'The ID of the runner (compute node)',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    type: ProviderSandboxesResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listNodeSandboxes(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('runnerId') runnerId: string,
  ): Promise<ProviderSandboxesResponseDto> {
    const items = await this.providerNodesService.listNodeSandboxes(authContext.organizationId, runnerId)
    return { items }
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Aggregated billable usage per compute node',
    operationId: 'getProviderUsage',
    description:
      'Returns billable usage (vCPU · h, GiB · h, GPU · h) grouped by compute node and optionally by UTC day.',
  })
  @ApiResponse({
    status: 200,
    type: ProviderUsageResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async getUsage(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: ProviderUsageQueryDto,
  ): Promise<ProviderUsageResponseDto> {
    return this.providerUsageService.getUsage(authContext.organizationId, {
      from: query.from,
      to: query.to,
      granularity: query.granularity,
      runnerId: query.runnerId,
    })
  }

  @Get('pricing')
  @ApiOperation({
    summary: 'List hourly prices per compute node',
    operationId: 'listProviderPricing',
  })
  @ApiResponse({
    status: 200,
    type: ProviderPricingResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listPricing(@IsOrganizationAuthContext() authContext: OrganizationAuthContext): Promise<ProviderPricingResponseDto> {
    return this.providerPricingService.listPricing(authContext.organizationId)
  }

  @Put('pricing/:runnerId')
  @ApiOperation({
    summary: 'Create or update the hourly prices of a compute node',
    operationId: 'upsertProviderPricing',
    description: 'All prices are integer cents per hour. The node must belong to the organization.',
  })
  @ApiParam({
    name: 'runnerId',
    description: 'The ID of the runner (compute node)',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    type: ProviderPricingItemDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async upsertPricing(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('runnerId') runnerId: string,
    @Body() dto: UpsertProviderPricingDto,
  ): Promise<ProviderPricingItemDto> {
    return this.providerPricingService.upsertPricing(authContext.organizationId, runnerId, dto)
  }

  @Get('earnings')
  @ApiOperation({
    summary: 'Provider earnings per compute node and day',
    operationId: 'getProviderEarnings',
    description:
      'Returns revenue per node per UTC day. Settled days are read from the settlement table, unsettled days are priced in real time.',
  })
  @ApiResponse({
    status: 200,
    type: ProviderEarningsResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async getEarnings(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: ProviderEarningsQueryDto,
  ): Promise<ProviderEarningsResponseDto> {
    return this.providerEarningsService.getEarnings(authContext.organizationId, query)
  }

  @Get('settlements')
  @ApiOperation({
    summary: 'List provider settlements',
    operationId: 'listProviderSettlements',
  })
  @ApiResponse({
    status: 200,
    type: ProviderSettlementsResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listSettlements(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: ProviderSettlementsQueryDto,
  ): Promise<ProviderSettlementsResponseDto> {
    return this.providerSettlementService.getSettlements(authContext.organizationId, query)
  }

  @Get('settlements/:id')
  @ApiOperation({
    summary: 'Get a provider settlement with its per-sandbox breakdown',
    operationId: 'getProviderSettlement',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the settlement period',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    type: ProviderSettlementDetailDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async getSettlement(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<ProviderSettlementDetailDto> {
    return this.providerSettlementService.getSettlementDetail(authContext.organizationId, id)
  }

  @Patch('settlements/:id/status')
  @ApiOperation({
    summary: 'Request a payout for a settled period',
    operationId: 'updateProviderSettlementStatus',
    description:
      'Organization owners can move a SETTLED settlement to WITHDRAWING and a WITHDRAWING one to WITHDRAWN. The platform marks PENDING settlements as SETTLED.',
    })
  @ApiParam({
    name: 'id',
    description: 'The ID of the settlement period',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    type: ProviderSettlementItemDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async updateSettlementStatus(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateProviderSettlementStatusDto,
  ): Promise<ProviderSettlementItemDto> {
    if (authContext.organizationUser.role !== OrganizationMemberRole.OWNER) {
      throw new ForbiddenException('Only organization owners can request payouts')
    }

    return this.providerSettlementService.updateStatus(authContext.organizationId, id, dto)
  }

  @Get('alerts')
  @ApiOperation({
    summary: 'List alerts for the compute nodes of the organization',
    operationId: 'listProviderAlerts',
    description: 'Defaults to open alerts. Alerts are raised automatically for offline nodes, failed health probes, high latency and resource pressure.',
  })
  @ApiResponse({
    status: 200,
    type: ProviderAlertsResponseDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.READ_RUNNERS])
  async listAlerts(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: ProviderAlertsQueryDto,
  ): Promise<ProviderAlertsResponseDto> {
    return this.providerAlertsService.listAlerts(authContext.organizationId, query)
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resolve an alert of a compute node',
    operationId: 'resolveProviderAlert',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the alert',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    type: ProviderAlertItemDto,
  })
  @RequiredOrganizationResourcePermissions([OrganizationResourcePermission.WRITE_RUNNERS])
  async resolveAlert(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('id') id: string,
  ): Promise<ProviderAlertItemDto> {
    return this.providerAlertsService.resolveAlert(authContext.organizationId, id)
  }
}
