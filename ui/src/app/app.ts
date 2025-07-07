import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from './websocket.service';
import { AudioService } from './audio.service';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { MagiStatus, MagiHealth } from './components/base-magi.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BalthasarComponent } from './components/balthasar.component';
import { CasperComponent } from './components/casper.component';
import { MelchiorComponent } from './components/melchior.component';

const DO_NOT_START_MAGI = false;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, BalthasarComponent, CasperComponent, MelchiorComponent]
})

export class AppComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('logsContainer') logsContainer!: ElementRef<HTMLDivElement>;
  
  protected title = 'ui';
  balthasarStatus: MagiStatus = 'offline';
  casperStatus: MagiStatus = 'offline';
  melchiorStatus: MagiStatus = 'offline';
  displayLogs = false;
  isMagiStarting = false;
  private isUserScrolling = false;
  private shouldAutoScroll = true;
  serverLogs: string[] = [];
  userInquiry = '';
  isOrchestratorAvailable = false;
  orchestratorStatus: 'available' | 'busy' | 'error' = 'error';
  isConnected = false;
  isPlaying = false;
  isRecording = false;
  currentText = '';
  isProcessing = false;

  private subscriptions = new Subscription();
  private readonly ORCHESTRATOR_HEALTH_URL = 'http://localhost:8080/health';

  private audioService = inject(AudioService);
  private websocketService = inject(WebsocketService);
  private http = inject(HttpClient);

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

          // Use websocketService.isConnected() to check connection
          const isWebSocketConnected = this.websocketService.isConnected();
          console.log(`Orchestrator available: ${this.isOrchestratorAvailable}, WebSocket connected: ${isWebSocketConnected}`);
          
          if (this.isOrchestratorAvailable && !isWebSocketConnected) {
            console.log('Orchestrator is available but WebSocket is not connected. Attempting to connect...');
            this.connectWebSocket();
          } else if (!this.isOrchestratorAvailable) {
            console.log('Orchestrator is not available. Skipping WebSocket connection.');
          } else if (isWebSocketConnected) {
            console.log('WebSocket is already connected.');
          }
        },
        error: (error) => {
          this.isOrchestratorAvailable = false;
          this.orchestratorStatus = 'error';
          // Set all Magi statuses to offline if orchestrator is offline
          this.balthasarStatus = 'offline';
          this.casperStatus = 'offline';
          this.melchiorStatus = 'offline';
          console.error('Orchestrator health check failed:', error);
          console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
          this.serverLogs.push(`[CLIENT] Orchestrator health check failed: ${error.message || 'Unknown error'}`);
        }
      })
    );
  }

  private connectWebSocket(): void {
    console.log('connectWebSocket() called');
    this.serverLogs.push('[CLIENT] Initiating WebSocket connection to Orchestrator...');
    this.websocketService.startConnecting(DO_NOT_START_MAGI);
    this.serverLogs.push(`[CLIENT] WebSocket connection request sent. DO_NOT_START_MAGI=${DO_NOT_START_MAGI}`);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.websocketService.disconnect();
  }

  async startMagi(): Promise<void> {
    await this.startMagiWithInquiry(this.userInquiry);
  }

  async startMagiWithInquiry(inquiry: string): Promise<void> {
    console.log('startMagiWithInquiry() called with:', inquiry);
    if (this.isMagiStarting) {
      console.log('Magi is already starting, aborting');
      return;
    }
    
    // Resume audio context for browsers that require user interaction
    await this.audioService.resumeAudioContext();
    
    // Reset audio queue for new deliberation
    this.audioService.resetAudioQueue();
    
    this.isMagiStarting = true;
    console.log(`Starting Magi with inquiry: ${inquiry}`);
    this.serverLogs.push(`[CLIENT] Starting Magi with inquiry: ${inquiry || 'none'}`);
    this.serverLogs.push('[CLIENT] Connecting to Orchestrator WebSocket...');
    this.websocketService.startConnecting(true, inquiry);
  }

  submitQuestion(): void {
    const inquiry = this.userInquiry; // Capture the inquiry before clearing
    this.userInquiry = ''; // Clear the input field immediately
    this.startMagiWithInquiry(inquiry); // Pass the captured inquiry
  }

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
  }

  clearLogs() {
    this.serverLogs = [];
  }

  ngAfterViewChecked() {
    if (this.shouldAutoScroll && this.displayLogs && this.logsContainer) {
      this.scrollToBottom();
    }
  }

  onLogsScroll(event: Event) {
    if (!this.logsContainer) return;
    
    const element = this.logsContainer.nativeElement;
    const tolerance = 10; // Allow small tolerance for scroll position
    
    // Check if user is near the bottom
    const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - tolerance;
    
    // Enable auto-scroll if user scrolled to bottom, disable if they scrolled up
    this.shouldAutoScroll = isNearBottom;
    
    // Reset user scrolling flag after a delay
    this.isUserScrolling = true;
    setTimeout(() => {
      this.isUserScrolling = false;
    }, 150);
  }

  private scrollToBottom() {
    if (!this.logsContainer || this.isUserScrolling) return;
    
    try {
      const element = this.logsContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    } catch (err) {
      // Ignore scroll errors
    }
  }
}
