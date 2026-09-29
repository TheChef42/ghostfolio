import { PerformanceScopeResolver } from './performance-scope.resolver';

describe('PerformanceScopeResolver', () => {
  const resolver = new PerformanceScopeResolver();

  it('canonicalizes an explicit account subset', () => {
    expect(
      resolver.resolve({
        accessibleAccountIds: ['b', 'a', 'c'],
        requestedAccountIds: ['b', 'a', 'b']
      })
    ).toEqual({
      accountIds: ['a', 'b'],
      identity: 'a,b',
      type: 'ACCOUNT_SUBSET'
    });
  });

  it('uses the non-excluded default portfolio scope', () => {
    expect(
      resolver.resolve({
        accessibleAccountIds: ['a', 'b'],
        defaultAccountIds: ['b']
      })
    ).toEqual({
      accountIds: ['b'],
      identity: 'b',
      type: 'WHOLE_PORTFOLIO'
    });
  });

  it('rejects inaccessible account ids', () => {
    expect(() =>
      resolver.resolve({
        accessibleAccountIds: ['a'],
        requestedAccountIds: ['other']
      })
    ).toThrow('The requested account scope is not available');
  });
});
