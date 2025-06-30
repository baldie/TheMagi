import { Component, Input } from '@angular/core';
import { BaseMagiComponent, MagiStatus } from './base-magi.component';

@Component({
  selector: '[app-casper]',
  templateUrl: './magi.component.html',
  styleUrls: ['./magi.scss'],
  standalone: false,
})
export class CasperComponent extends BaseMagiComponent {
  @Input() override status: MagiStatus = 'off';

  constructor() {
    super();
    this.pathData = "M100,300 L350,300 L450,400 L450,500 L100,500 Z";
  }
} 