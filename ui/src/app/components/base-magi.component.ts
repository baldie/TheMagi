import { Component, Input } from '@angular/core';

export type MagiStatus = 'offline' | 'busy' | 'evailable';

export type MagiHealth = {
  status: 'available' | 'busy' | 'error';
  magi: {
    balthazar: { status: MagiStatus; };
    caspar: { status: MagiStatus; };
    melchior: { status: MagiStatus; };
  }
}

@Component({
  template: '',
  standalone: true,
})
export class BaseMagiComponent {
  @Input() status: MagiStatus = 'offline';
  pathData = '';
} 