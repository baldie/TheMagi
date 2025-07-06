import { Component, Input } from '@angular/core';
import { BaseMagiComponent, MagiStatus } from './base-magi.component';

@Component({
  selector: '[app-melchior]',
  templateUrl: './magi.component.html',
  styleUrls: ['./magi.scss'],
  standalone: true,
})
export class MelchiorComponent extends BaseMagiComponent {
  @Input() override status: MagiStatus = 'offline';

  constructor() {
    super();
    this.pathData = "M850,300 L1100,300 L1100,500 L750,500 L750,400 Z";
  }
} 