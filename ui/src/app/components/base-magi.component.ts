import { Component, Input } from '@angular/core';

@Component({
  template: '',
  standalone: false,
})
export class BaseMagiComponent {
  @Input() status: 'off' | 'loading' | 'ready' | 'error' | 'thinking' = 'off';
  pathData = '';
} 