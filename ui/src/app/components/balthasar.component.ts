import { Component } from '@angular/core';
import { BaseMagiComponent } from './base-magi.component';

@Component({
  selector: '[app-balthasar]',
  templateUrl: './magi.component.html',
  styleUrls: ['./magi.scss'],
  standalone: false,
})
export class BalthasarComponent extends BaseMagiComponent {
  constructor() {
    super();
    this.pathData = "M450,50 L750,50 L750,300 L700,350 L500,350 L450,300 Z";
  }
} 