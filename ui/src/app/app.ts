import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from './websocket.service';
import { Subscription } from 'rxjs';
import { MagiStatus } from './components/base-magi.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrls: ['./components/magi.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  protected title = 'ui';
  balthasarStatus: MagiStatus = 'off';
  casperStatus: MagiStatus = 'off';
  melchiorStatus: MagiStatus = 'off';
  displayLogs: boolean = false;
  isMagiStarting: boolean = false;
  serverLogs: string[] = [];

  private subscriptions = new Subscription();
  private readonly LAUNCHER_URL = 'http://localhost:3000/start';

  constructor(
    private websocketService: WebsocketService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    // Mock status changes for demonstration
    // ... existing code ...

    this.subscriptions.add(
      this.websocketService.isProcessRunning$.subscribe(isRunning => {
        this.isMagiStarting = isRunning;
      })
    );

    this.subscriptions.add(
      this.websocketService.logs$.subscribe(log => {
        this.serverLogs.push(log);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.websocketService.disconnect();
  }

  startMagi(): void {
    if (this.isMagiStarting) {
      return;
    }
    this.isMagiStarting = true;
    this.serverLogs = ['[CLIENT] Initiating Magi startup...'];

    this.http.post(this.LAUNCHER_URL, {}).subscribe({
      next: () => {
        this.serverLogs.push('[CLIENT] Launcher acknowledged start signal.');
        this.serverLogs.push('[CLIENT] Now attempting to connect to Orchestrator WebSocket...');
        this.websocketService.startConnecting();
      },
      error: (err) => {
        this.serverLogs.push(`[CLIENT] ERROR: Failed to contact launcher service at ${this.LAUNCHER_URL}.`);
        this.serverLogs.push(`[CLIENT] Is the launcher service running? Details: ${err.message}`);
        this.isMagiStarting = false;
      }
    });
  }

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
  }
}
