import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
})
export class App {
  protected title = 'ui';
  balthasarStatus: 'off' | 'loading' | 'ready' | 'error' | 'thinking' = 'ready';
  casperStatus: 'off' | 'loading' | 'ready' | 'error' | 'thinking' = 'ready';
  melchiorStatus: 'off' | 'loading' | 'ready' | 'error' | 'thinking' = 'ready';
  displayLogs = false;

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
  }
}
