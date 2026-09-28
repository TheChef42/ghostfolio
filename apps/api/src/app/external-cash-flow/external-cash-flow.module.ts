import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { ExternalCashFlowResponseInterceptor } from './external-cash-flow-response.interceptor';
import { ExternalCashFlowController } from './external-cash-flow.controller';
import { ExternalCashFlowService } from './external-cash-flow.service';

@Module({
  controllers: [ExternalCashFlowController],
  imports: [ImpersonationModule, PrismaModule],
  providers: [ExternalCashFlowService, ExternalCashFlowResponseInterceptor],
  exports: [ExternalCashFlowService]
})
export class ExternalCashFlowModule {}
