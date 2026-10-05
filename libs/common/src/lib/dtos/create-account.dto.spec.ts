import { validate } from 'class-validator';

import { CreateAccountDto } from './create-account.dto';

function account(inceptionDate?: string | null) {
  return Object.assign(new CreateAccountDto(), {
    currency: 'DKK',
    inceptionDate,
    name: 'Broker',
    platformId: null
  });
}

describe('CreateAccountDto inceptionDate', () => {
  it.each([undefined, null, '2025-01-01'])(
    'accepts backward-compatible value %s',
    async (inceptionDate) => {
      await expect(validate(account(inceptionDate))).resolves.toEqual([]);
    }
  );

  it('rejects a malformed date', async () => {
    const errors = await validate(account('not-a-date'));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'inceptionDate' })
      ])
    );
  });
});
