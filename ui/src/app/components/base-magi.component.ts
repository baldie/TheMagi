import { Component, Input } from '@angular/core';

export type MagiStatus = 'off' | 'loading' | 'ready' | 'error' | 'thinking';

@Component({
  template: '',
  standalone: false,
})
export class BaseMagiComponent {
  @Input() status: MagiStatus = 'off';
  pathData = '';
} 