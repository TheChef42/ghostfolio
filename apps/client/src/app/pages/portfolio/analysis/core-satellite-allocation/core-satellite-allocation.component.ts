import { PortfolioPosition } from '@ghostfolio/common/interfaces';
import { GfValueComponent } from '@ghostfolio/ui/value';

import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';

import { CORE_SATELLITE_TARGETS } from './core-satellite-allocation.constants';

export interface CoreSatelliteAllocation {
  ambiguousHoldings: string[];
  coreWeight: number;
  coreDeviation: number;
  otherWeight: number;
  satelliteWeight: number;
  satelliteDeviation: number;
  totalValue: number;
}

export function calculateCoreSatelliteAllocation(
  holdings: PortfolioPosition[] = []
): CoreSatelliteAllocation {
  let coreValue = 0;
  let otherValue = 0;
  let satelliteValue = 0;
  const ambiguousHoldings: string[] = [];

  for (const holding of holdings) {
    const value = Number(holding.valueInBaseCurrency);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    const tagNames = new Set(
      (holding.tags ?? []).map(({ name }) => name.trim())
    );
    const isCore = tagNames.has('Core');
    const isSatellite = tagNames.has('Satellite');

    if (isCore && isSatellite) {
      otherValue += value;
      ambiguousHoldings.push(
        holding.assetProfile?.name ?? holding.assetProfile?.symbol ?? '—'
      );
    } else if (isCore) {
      coreValue += value;
    } else if (isSatellite) {
      satelliteValue += value;
    } else {
      otherValue += value;
    }
  }

  const totalValue = coreValue + satelliteValue + otherValue;
  const coreWeight = totalValue > 0 ? coreValue / totalValue : 0;
  const satelliteWeight = totalValue > 0 ? satelliteValue / totalValue : 0;
  const otherWeight = totalValue > 0 ? otherValue / totalValue : 0;

  return {
    ambiguousHoldings,
    coreDeviation: coreWeight - CORE_SATELLITE_TARGETS.core,
    coreWeight,
    otherWeight,
    satelliteDeviation: satelliteWeight - CORE_SATELLITE_TARGETS.satellite,
    satelliteWeight,
    totalValue
  };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GfValueComponent, MatCardModule],
  selector: 'gf-core-satellite-allocation',
  styleUrls: ['./core-satellite-allocation.component.scss'],
  templateUrl: './core-satellite-allocation.component.html'
})
export class GfCoreSatelliteAllocationComponent implements OnChanges {
  @Input() public holdings: PortfolioPosition[] = [];
  @Input() public locale: string;

  public allocation = calculateCoreSatelliteAllocation();
  protected readonly targets = CORE_SATELLITE_TARGETS;

  public ngOnChanges() {
    this.allocation = calculateCoreSatelliteAllocation(this.holdings);
  }
}
