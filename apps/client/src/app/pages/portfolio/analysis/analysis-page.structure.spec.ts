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
    expect(template).toContain('Absolute Asset Performance');
    expect(template).toContain('>Top<');
    expect(template).toContain('>Bottom<');
    expect(template).toContain('Portfolio Evolution');
    expect(template).toContain('Investment Timeline');
    expect(template).toContain('Dividend Timeline');
  });
});
