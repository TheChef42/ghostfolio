import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { validate } from 'class-validator';

import { GetAnalyticsPerformanceDto } from './get-analytics-performance.dto';

describe('GetAnalyticsPerformanceDto', () => {
  it.each([
    PerformanceCalculationType.MODIFIED_DIETZ,
    PerformanceCalculationType.TWR,
    PerformanceCalculationType.XIRR
  ])('accepts the explicit analytics method %s', async (method) => {
    const dto = Object.assign(new GetAnalyticsPerformanceDto(), { method });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a legacy performance method', async () => {
    const dto = Object.assign(new GetAnalyticsPerformanceDto(), {
      method: PerformanceCalculationType.MWR
    });
    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'method' })])
    );
  });
});
