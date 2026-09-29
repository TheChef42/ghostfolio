import { PortfolioPosition } from '@ghostfolio/common/interfaces';

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import '@angular/localize/init';

import {
  calculateCoreSatelliteAllocation,
  GfCoreSatelliteAllocationComponent
} from './core-satellite-allocation.component';

jest.mock('@ghostfolio/ui/value', () => ({ GfValueComponent: class {} }));

function holding(
  valueInBaseCurrency: number,
  tags: string[],
  name = tags.join('/') || 'Other'
) {
  return {
    assetProfile: { name, symbol: name },
    tags: tags.map((tag, index) => ({ id: `${index}`, name: tag })),
    valueInBaseCurrency
  } as PortfolioPosition;
}

describe('calculateCoreSatelliteAllocation', () => {
  it('uses current market values for Core, Satellite and Other weights', () => {
    const result = calculateCoreSatelliteAllocation([
      holding(70, ['Core']),
      holding(30, ['Satellite']),
      holding(100, [])
    ]);

    expect(result.coreWeight).toBeCloseTo(0.35);
    expect(result.satelliteWeight).toBeCloseTo(0.15);
    expect(result.otherWeight).toBeCloseTo(0.5);
    expect(
      result.coreWeight + result.satelliteWeight + result.otherWeight
    ).toBeCloseTo(1);
    expect(result.coreDeviation).toBeCloseTo(-0.35);
    expect(result.satelliteDeviation).toBeCloseTo(-0.15);
  });

  it('matches the isolated 70 / 30 targets', () => {
    const result = calculateCoreSatelliteAllocation([
      holding(70, ['Core']),
      holding(30, ['Satellite'])
    ]);

    expect(result.coreWeight).toBeCloseTo(0.7);
    expect(result.satelliteWeight).toBeCloseTo(0.3);
    expect(result.coreDeviation).toBeCloseTo(0);
    expect(result.satelliteDeviation).toBeCloseTo(0);
  });

  it('counts a double-tagged holding once under Other and reports ambiguity', () => {
    const result = calculateCoreSatelliteAllocation([
      holding(40, ['Core', 'Satellite'], 'Ambiguous'),
      holding(60, ['Core'])
    ]);

    expect(result.coreWeight).toBeCloseTo(0.6);
    expect(result.satelliteWeight).toBe(0);
    expect(result.otherWeight).toBeCloseTo(0.4);
    expect(result.ambiguousHoldings).toEqual(['Ambiguous']);
  });

  it('is safe for empty, invalid and non-positive values', () => {
    const result = calculateCoreSatelliteAllocation([
      holding(Number.NaN, ['Core']),
      holding(-1, ['Satellite']),
      holding(0, [])
    ]);

    expect(result.totalValue).toBe(0);
    for (const value of [
      result.coreWeight,
      result.satelliteWeight,
      result.otherWeight
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GfCoreSatelliteAllocationComponent', () => {
  let fixture: ComponentFixture<GfCoreSatelliteAllocationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GfCoreSatelliteAllocationComponent]
    })
      .overrideComponent(GfCoreSatelliteAllocationComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] }
      })
      .compileComponents();
    fixture = TestBed.createComponent(GfCoreSatelliteAllocationComponent);
  });

  it('recalculates when the selected account scope supplies new holdings', () => {
    fixture.componentRef.setInput('holdings', [holding(100, ['Core'])]);
    fixture.detectChanges();
    expect(fixture.componentInstance.allocation.coreWeight).toBe(1);

    fixture.componentRef.setInput('holdings', [holding(100, ['Satellite'])]);
    fixture.detectChanges();
    expect(fixture.componentInstance.allocation.satelliteWeight).toBe(1);
    expect(fixture.componentInstance.allocation.coreWeight).toBe(0);
  });

  it('renders a safe empty state without invalid numeric output', () => {
    fixture.componentRef.setInput('holdings', []);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('No invested holdings');
    expect(text).not.toMatch(/NaN|Infinity/);
  });
});
