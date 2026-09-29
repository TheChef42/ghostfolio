import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon, MatButtonModule, MatMenuModule],
  selector: 'gf-analytics-info',
  styleUrls: ['./analytics-info.component.scss'],
  templateUrl: './analytics-info.component.html'
})
export class GfAnalyticsInfoComponent {
  @Input() public accessibleLabel: string;
  @Input() public text: string;

  public constructor() {
    addIcons({ informationCircleOutline });
  }
}
