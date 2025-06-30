import { Component } from '@angular/core';
import { BaseMagiComponent } from './base-magi.component';

@Component({
  selector: '[app-melchior]',
  templateUrl: './magi.component.html',
  styleUrls: ['./magi.scss'],
  standalone: false,
})
export class MelchiorComponent extends BaseMagiComponent {
  constructor() {
    super();
    this.pathData = "M850,300 L1100,300 L1100,500 L750,500 L750,400 Z";
  }
} 