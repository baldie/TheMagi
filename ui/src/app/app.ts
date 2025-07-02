import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from './websocket.service';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
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
  userInquiry: string = '';
  isOrchestratorAvailable: boolean = false;

  private subscriptions = new Subscription();
  private readonly ORCHESTRATOR_HEALTH_URL = 'http://localhost:8080/health';

  constructor(
    private websocketService: WebsocketService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
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

    this.subscriptions.add(
      timer(0, 5000).pipe(
        switchMap(() => this.http.get(this.ORCHESTRATOR_HEALTH_URL, { observe: 'response' }))
      ).subscribe({
        next: (response) => {
          this.isOrchestratorAvailable = response.status === 200;
          console.log('Orchestrator availability:', this.isOrchestratorAvailable);
        },
        error: (error) => {
          this.isOrchestratorAvailable = false;
          console.error(error);
        }
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
    this.serverLogs.push('[CLIENT] Now attempting to connect to Orchestrator WebSocket...');
    this.websocketService.startConnecting(true, this.userInquiry);
  }

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
  }
}
