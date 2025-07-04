import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from './websocket.service';
import { AudioService } from './audio.service';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { MagiStatus, MagiHealth } from './components/base-magi.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrls: ['./components/magi.scss']
})

export class AppComponent implements OnInit, OnDestroy {
  protected title = 'ui';
  balthasarStatus: MagiStatus = 'offline';
  casperStatus: MagiStatus = 'offline';
  melchiorStatus: MagiStatus = 'offline';
  displayLogs: boolean = false;
  isMagiStarting: boolean = false;
  serverLogs: string[] = [];
  userInquiry: string = '';
  isOrchestratorAvailable: boolean = false;
  orchestratorStatus: 'available' | 'busy' | 'error' = 'error';

  private subscriptions = new Subscription();
  private readonly ORCHESTRATOR_HEALTH_URL = 'http://localhost:8080/health';

  constructor(
    private websocketService: WebsocketService,
    private http: HttpClient,
    private audioService: AudioService
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
      this.websocketService.audio$.subscribe(audioMessage => {
        this.audioService.playAudioMessage(audioMessage);
      })
    );

    this.subscriptions.add(
      timer(0, 5000).pipe(
        switchMap(() => this.http.get<MagiHealth>(this.ORCHESTRATOR_HEALTH_URL))
      ).subscribe({
        next: (response) => {

          this.isOrchestratorAvailable = response.status === 'available';
          
          // Show the status of each individual Magi
          const {balthazar, caspar, melchior} = response.magi;
          this.balthasarStatus = balthazar.status;
          this.casperStatus = caspar.status;
          this.melchiorStatus = melchior.status;
          
          this.orchestratorStatus = response.status === 'available' ? 'available' : response.status === 'busy' ? 'busy' : 'error';
          console.log('Orchestrator status:', this.orchestratorStatus);
        },
        error: (error) => {
          this.isOrchestratorAvailable = false;
          this.orchestratorStatus = 'error';
          console.error(error);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.websocketService.disconnect();
  }

  async startMagi(): Promise<void> {
    if (this.isMagiStarting) {
      return;
    }
    
    // Resume audio context for browsers that require user interaction
    await this.audioService.resumeAudioContext();
    
    this.isMagiStarting = true;
    this.serverLogs = ['[CLIENT] Initiating Magi startup...'];
    this.serverLogs.push('[CLIENT] Now attempting to connect to Orchestrator WebSocket...');
    this.websocketService.startConnecting(true, this.userInquiry);
  }

  submitQuestion(): void {
    // This will be implemented later
  }

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
  }

  clearLogs() {
    this.serverLogs = [];
  }
}
