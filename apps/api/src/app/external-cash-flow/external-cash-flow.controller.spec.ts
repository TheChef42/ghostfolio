import { ImpersonationWriteGuard } from '@ghostfolio/api/guards/impersonation-write.guard';
import { ImpersonationService } from '@ghostfolio/api/services/impersonation/impersonation.service';
import { HEADER_KEY_IMPERSONATION } from '@ghostfolio/common/config';
import { getPermissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';

import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ExternalCashFlowResponseInterceptor } from './external-cash-flow-response.interceptor';
import { ExternalCashFlowController } from './external-cash-flow.controller';
import { ExternalCashFlowService } from './external-cash-flow.service';

const secret = 'synthetic-phase1-http-tests-only';
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  public constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      algorithms: ['HS256']
    });
  }
  public validate(payload: {
    sub: string;
    role?: Role;
    zen?: boolean;
    restricted?: boolean;
  }) {
    return {
      id: payload.sub,
      permissions: getPermissions(payload.role ?? 'USER'),
      settings: {
        settings: {
          viewMode: payload.zen ? 'ZEN' : 'DEFAULT',
          isRestrictedView: payload.restricted ?? false
        }
      }
    };
  }
}

describe('ExternalCashFlow HTTP access and serialization', () => {
  let app: INestApplication;
  let baseUrl: string;
  const jwt = new JwtService({ secret });
  const accountId = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const flow = {
    id,
    userId: 'owner',
    accountId,
    amount: new Prisma.Decimal('999999999999999999.999999999999999999'),
    currency: 'EUR',
    date: new Date('2026-01-01Z'),
    type: 'DEPOSIT',
    transferGroupId: null,
    source: 'bank reference',
    comment: 'private note',
    createdAt: new Date('2026-01-01Z'),
    updatedAt: new Date('2026-01-01Z')
  };
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    getTransfer: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createTransfer: jest.fn(),
    updateTransfer: jest.fn(),
    deleteTransfer: jest.fn()
  };
  const input = {
    accountId,
    amount: '1',
    currency: 'EUR',
    date: '2026-01-01',
    type: 'DEPOSIT'
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ExternalCashFlowController],
      providers: [
        TestJwtStrategy,
        ExternalCashFlowResponseInterceptor,
        { provide: ExternalCashFlowService, useValue: service },
        {
          provide: ImpersonationService,
          useValue: {
            resolve: async ({ user, impersonationId }) => ({
              userId: impersonationId ? 'shared-owner' : user.id,
              isActive: !!impersonationId,
              userSettings: {},
              scopes:
                impersonationId === 'public'
                  ? [scopes.portfolioRead]
                  : impersonationId
                    ? [scopes.accountRead]
                    : Object.values(scopes)
            })
          }
        }
      ]
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    app.useGlobalGuards(new ImpersonationWriteGuard(module.get(Reflector)));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.get.mockResolvedValue(flow);
    service.list.mockResolvedValue({ items: [flow], count: 1 });
    service.create.mockResolvedValue(flow);
    service.update.mockResolvedValue(flow);
    service.delete.mockResolvedValue(flow);
    service.createTransfer.mockResolvedValue({
      items: [flow, flow],
      transferGroupId: id
    });
    service.getTransfer.mockResolvedValue({
      items: [flow, flow],
      transferGroupId: id
    });
    service.updateTransfer.mockResolvedValue({
      items: [flow, flow],
      transferGroupId: id
    });
    service.deleteTransfer.mockResolvedValue({
      items: [flow, flow],
      transferGroupId: id
    });
  });
  afterAll(async () => app?.close());
  const request = (
    path: string,
    method = 'GET',
    body?: object,
    payload: object | null = {},
    share?: string
  ) =>
    fetch(`${baseUrl}/external-cash-flow${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload === null
          ? {}
          : {
              Authorization: `Bearer ${jwt.sign({ sub: 'owner', ...payload })}`
            }),
        ...(share ? { [HEADER_KEY_IMPERSONATION]: share } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

  it('rejects unauthenticated requests', async () => {
    expect((await request('', 'GET', undefined, null)).status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('returns exact decimal strings without ownership identifiers', async () => {
    const response = await request(`/${id}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      id,
      amount: '999999999999999999.999999999999999999'
    });
    expect(data).not.toHaveProperty('userId');
    expect(service.get).toHaveBeenCalledWith('owner', id);
  });
  it.each([{ zen: true }, { restricted: true }])(
    'redacts single and collection amounts and free text for %j',
    async (payload) => {
      expect(
        await (await request(`/${id}`, 'GET', undefined, payload)).json()
      ).toMatchObject({ amount: null, source: null, comment: null });
      expect(
        await (await request('', 'GET', undefined, payload)).json()
      ).toMatchObject({
        items: [{ amount: null, source: null, comment: null }]
      });
    }
  );
  it('uses shared owner and redacts when monetary read scope is absent', async () => {
    expect(
      await (await request('', 'GET', undefined, {}, 'read-only')).json()
    ).toMatchObject({ items: [{ amount: null, source: null, comment: null }] });
    expect(service.list.mock.calls[0][0]).toBe('shared-owner');
  });
  it('does not expose the ledger through public access', async () => {
    expect((await request('', 'GET', undefined, {}, 'public')).status).toBe(
      403
    );
    expect(service.list).not.toHaveBeenCalled();
  });
  it('denies read-only shared writes and demo writes', async () => {
    expect((await request('', 'POST', input, {}, 'read-only')).status).toBe(
      403
    );
    expect((await request('', 'POST', input, { role: 'DEMO' })).status).toBe(
      403
    );
    expect(service.create).not.toHaveBeenCalled();
  });
  it('validates ownership injection, numeric amounts, missing legs and UUID paths', async () => {
    expect(
      (await request('', 'POST', { ...input, userId: 'foreign' })).status
    ).toBe(400);
    expect((await request('', 'POST', { ...input, amount: 1 })).status).toBe(
      400
    );
    expect((await request('/transfer', 'POST', {})).status).toBe(400);
    expect((await request('/not-a-uuid')).status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.createTransfer).not.toHaveBeenCalled();
  });
  it('routes ordinary create/update/delete through guarded handlers', async () => {
    expect((await request('', 'POST', input)).status).toBe(201);
    expect((await request(`/${id}`, 'PATCH', { amount: '2' })).status).toBe(
      200
    );
    expect((await request(`/${id}`, 'DELETE')).status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'owner',
      id,
      expect.objectContaining({ amount: '2' })
    );
  });
  it('routes paired mutations and redacts their responses in ZEN mode', async () => {
    const leg = { accountId, amount: '1', currency: 'EUR', date: '2026-01-01' };
    const response = await request(
      '/transfer',
      'POST',
      { from: leg, to: leg },
      { zen: true }
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      items: [{ amount: null }, { amount: null }]
    });
    expect((await request(`/transfer/${id}`)).status).toBe(200);
    expect(service.getTransfer).toHaveBeenCalledWith('owner', id);
    expect(
      (await request(`/transfer/${id}`, 'PUT', { from: leg, to: leg })).status
    ).toBe(200);
    expect((await request(`/transfer/${id}`, 'DELETE')).status).toBe(200);
    expect(service.deleteTransfer).toHaveBeenCalledWith('owner', id);
  });
});
