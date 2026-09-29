import { DataSource } from '@prisma/client';
import { validate } from 'class-validator';

import { GetAnalyticsBenchmarkDto } from './get-analytics-benchmark.dto';

describe('GetAnalyticsBenchmarkDto', () => {
  it.each(['TWR', 'CASH_FLOW_MATCHED'])(
    'accepts explicit benchmark mode %s',
    async (mode) => {
      const dto = Object.assign(new GetAnalyticsBenchmarkDto(), {
        dataSource: DataSource.YAHOO,
        from: '2024-01-01',
        mode,
        range: 'custom',
        symbol: 'SPY',
        to: '2024-12-31'
      });
      expect(await validate(dto)).toEqual([]);
    }
  );

  it('rejects an unknown mode', async () => {
    const dto = Object.assign(new GetAnalyticsBenchmarkDto(), {
      mode: 'ALPHA',
      range: 'custom'
    });
    const errors = await validate(dto);
    expect(errors.map(({ property }) => property)).toContain('mode');
  });
});
