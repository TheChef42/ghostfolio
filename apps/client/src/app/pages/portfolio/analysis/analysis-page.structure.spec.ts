import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Portfolio Analysis page structure', () => {
  it('adds analytics to the existing Ghostfolio Analysis page without removing established sections', () => {
    const template = readFileSync(
      resolve(
        process.cwd(),
        'apps/client/src/app/pages/portfolio/analysis/analysis-page.html'
      ),
      'utf8'
    );

    expect(template).toContain('<gf-analytics-overview');
    expect(template).toContain('<gf-core-satellite-allocation');
    expect(template).toContain('Absolute Asset Performance');
    expect(template).toContain('>Top<');
    expect(template).toContain('>Bottom<');
    expect(template).toContain('Portfolio Evolution');
    expect(template).toContain('Investment Timeline');
    expect(template).toContain('Dividend Timeline');
  });

  it('keeps Core / Satellite on current holdings without historical analytics calls', () => {
    const page = readFileSync(
      resolve(
        process.cwd(),
        'apps/client/src/app/pages/portfolio/analysis/analysis-page.component.ts'
      ),
      'utf8'
    );
    const coreSatellite = readFileSync(
      resolve(
        process.cwd(),
        'apps/client/src/app/pages/portfolio/analysis/core-satellite-allocation/core-satellite-allocation.component.ts'
      ),
      'utf8'
    );

    expect(page).toContain('fetchPortfolioHoldings');
    expect(coreSatellite).not.toContain('fetchAnalytics');
    expect(coreSatellite).not.toContain('DataService');
  });
});
