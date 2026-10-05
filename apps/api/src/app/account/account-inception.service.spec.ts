import { AccountService } from './account.service';

function fixture() {
  const accountHistoryService = {
    validateInceptionDate: jest.fn().mockResolvedValue(undefined)
  };
  const prisma = {
    account: {
      create: jest.fn(async ({ data }) => ({
        ...data,
        id: 'account',
        userId: 'user'
      })),
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }) => ({
        ...data,
        id: 'account',
        userId: 'user'
      }))
    }
  };
  const service = new AccountService(
    {} as never,
    accountHistoryService as never,
    { emit: jest.fn() } as never,
    {} as never,
    prisma as never,
    { validateTagIdsWithoutDraftTag: jest.fn() } as never
  );
  return { accountHistoryService, prisma, service };
}

describe('AccountService inception date', () => {
  it('creates an account with a nullable inception date', async () => {
    const { accountHistoryService, prisma, service } = fixture();
    const inceptionDate = new Date('2025-01-01T00:00:00.000Z');

    await service.createAccount({
      data: {
        currency: 'DKK',
        inceptionDate,
        name: 'Broker',
        user: { connect: { id: 'user' } }
      },
      userId: 'user'
    });

    expect(accountHistoryService.validateInceptionDate).toHaveBeenCalledWith({
      inceptionDate,
      userId: 'user'
    });
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ inceptionDate })
    });
  });

  it.each([
    ['sets', new Date('2025-01-01T00:00:00.000Z')],
    ['clears', null]
  ])('%s inception on update', async (_label, inceptionDate) => {
    const { accountHistoryService, prisma, service } = fixture();

    await service.updateAccount({
      data: { inceptionDate },
      userId: 'user',
      where: { id_userId: { id: 'account', userId: 'user' } }
    });

    expect(accountHistoryService.validateInceptionDate).toHaveBeenCalledWith({
      accountId: 'account',
      inceptionDate,
      userId: 'user'
    });
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inceptionDate })
      })
    );
  });

  it('round-trips inception from account reads', async () => {
    const { prisma, service } = fixture();
    const inceptionDate = new Date('2025-01-01T00:00:00.000Z');
    prisma.account.findUnique.mockResolvedValue({
      balances: [],
      currency: 'DKK',
      id: 'account',
      inceptionDate,
      name: 'Broker',
      userId: 'user'
    });

    await expect(
      service.account({ id_userId: { id: 'account', userId: 'user' } })
    ).resolves.toEqual(expect.objectContaining({ inceptionDate }));
  });
});
