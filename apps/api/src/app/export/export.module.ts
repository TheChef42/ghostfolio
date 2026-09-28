import { AccountModule } from '@ghostfolio/api/app/account/account.module';
import { ActivitiesModule } from '@ghostfolio/api/app/activities/activities.module';
import { ExternalCashFlowModule } from '@ghostfolio/api/app/external-cash-flow/external-cash-flow.module';
import { TransformDataSourceInRequestModule } from '@ghostfolio/api/interceptors/transform-data-source-in-request/transform-data-source-in-request.module';
import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { MarketDataModule } from '@ghostfolio/api/services/market-data/market-data.module';
import { TagModule } from '@ghostfolio/api/services/tag/tag.module';

import { Module } from '@nestjs/common';

import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  controllers: [ExportController],
  imports: [
    AccountModule,
    ActivitiesModule,
    ExternalCashFlowModule,
    ApiModule,
    MarketDataModule,
    TagModule,
    TransformDataSourceInRequestModule
  ],
  providers: [ExportService]
})
export class ExportModule {}
