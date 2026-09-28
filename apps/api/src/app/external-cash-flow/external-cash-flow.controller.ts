import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { permissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors
} from '@nestjs/common';

import { ExternalCashFlowResponseInterceptor } from './external-cash-flow-response.interceptor';
import {
  CreateExternalCashFlowDto,
  GetExternalCashFlowsDto,
  TransferExternalCashFlowDto,
  UpdateExternalCashFlowDto
} from './external-cash-flow.dto';
import { ExternalCashFlowService } from './external-cash-flow.service';

@Controller('external-cash-flow')
@UseInterceptors(ExternalCashFlowResponseInterceptor)
export class ExternalCashFlowController {
  public constructor(private readonly service: ExternalCashFlowService) {}

  @Get()
  @RequiresScope(scopes.accountRead)
  public list(
    @Impersonation() { userId }: ImpersonationContext,
    @Query() query: GetExternalCashFlowsDto
  ) {
    return this.service.list(userId, query);
  }

  @Get(':id')
  @RequiresScope(scopes.accountRead)
  public get(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.service.get(userId, id);
  }

  @Get('transfer/:id')
  @RequiresScope(scopes.accountRead)
  public getTransfer(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.service.getTransfer(userId, id);
  }

  @Post()
  @HasPermission(permissions.createAccountBalance)
  @RequiresScope(scopes.accountUpdate)
  public create(
    @Impersonation() { userId }: ImpersonationContext,
    @Body() data: CreateExternalCashFlowDto
  ) {
    return this.service.create(userId, data);
  }

  @Patch(':id')
  @HasPermission(permissions.updateAccount)
  @RequiresScope(scopes.accountUpdate)
  public update(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateExternalCashFlowDto
  ) {
    return this.service.update(userId, id, data);
  }

  @Delete(':id')
  @HasPermission(permissions.deleteAccountBalance)
  @RequiresScope(scopes.accountUpdate)
  public delete(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.service.delete(userId, id);
  }

  @Post('transfer')
  @HasPermission(permissions.createAccountBalance)
  @RequiresScope(scopes.accountUpdate)
  public createTransfer(
    @Impersonation() { userId }: ImpersonationContext,
    @Body() data: TransferExternalCashFlowDto
  ) {
    return this.service.createTransfer(userId, data);
  }

  @Put('transfer/:id')
  @HasPermission(permissions.updateAccount)
  @RequiresScope(scopes.accountUpdate)
  public updateTransfer(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: TransferExternalCashFlowDto
  ) {
    return this.service.updateTransfer(userId, id, data);
  }

  @Delete('transfer/:id')
  @HasPermission(permissions.deleteAccountBalance)
  @RequiresScope(scopes.accountUpdate)
  public deleteTransfer(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.service.deleteTransfer(userId, id);
  }
}
