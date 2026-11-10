/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { DocumentBuilder } from '@nestjs/swagger'

const getOpenApiConfig = (oidcIssuer: string) =>
  new DocumentBuilder()
    .setTitle('Roost')
    .addServer('http://localhost:3000')
    .setDescription('Roost API Docs')
    .setContact('Roost', 'https://roost.example', 'support@roost.example')
    .setVersion('1.0')
    .setLicense('Apache-2.0', 'https://www.apache.org/licenses/LICENSE-2.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      description: 'API Key access',
    })
    .addOAuth2({
      type: 'openIdConnect',
      flows: undefined,
      openIdConnectUrl: `${oidcIssuer}/.well-known/openid-configuration`,
    })
    .build()

export { getOpenApiConfig }
