import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from './websocket.service';
import { AudioService } from './audio.service';
import { Subscription, timer } from 'rxjs';
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
      timer(0, 5000).subscribe(() => this.performHealthCheck())
    );
  }

  private connectWebSocket(): void {
    this.serverLogs.push('[CLIENT] Initiating WebSocket connection to Orchestrator...');
    this.websocketService.startConnecting(DO_NOT_START_MAGI);
  }

  private updateHealthStatus(response: MagiHealth): void {
    this.isOrchestratorAvailable = response.status === 'available';
    const {balthazar, caspar, melchior} = response.magi;
    this.balthasarStatus = balthazar.status;
    this.casperStatus = caspar.status;
    this.melchiorStatus = melchior.status;
    this.orchestratorStatus = response.status === 'available' ? 'available' : response.status === 'busy' ? 'busy' : 'error';

    if (this.isOrchestratorAvailable &&
       this.balthasarStatus === 'available' &&
       this.casperStatus === 'available' &&
       this.melchiorStatus === 'available' &&
       this.orchestratorStatus === 'available') {
        this.isMagiStarting = false;
      }
  }

  private updateHealthStatusOnError(error: any): void {
    this.isOrchestratorAvailable = false;
    this.orchestratorStatus = 'error';
    this.balthasarStatus = 'offline';
    this.casperStatus = 'offline';
    this.melchiorStatus = 'offline';
    this.websocketService.disconnect();
    console.error('Orchestrator health check failed:', error);
    this.serverLogs.push(`[CLIENT] Orchestrator health check failed: ${error.message || 'Unknown error'}`);
  }

  private handleWebSocketConnection(): void {
    const isWebSocketConnected = this.websocketService.isConnected();
    
    if (this.isOrchestratorAvailable && !isWebSocketConnected) {
      this.connectWebSocket();
    }
  }

  private performHealthCheck(): void {
    this.http.get<MagiHealth>(this.ORCHESTRATOR_HEALTH_URL).subscribe({
      next: (response) => {
        this.updateHealthStatus(response);
        this.handleWebSocketConnection();
      },
      error: (error) => {
        this.updateHealthStatusOnError(error);
        console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.websocketService.disconnect();
  }

  async startMagi(): Promise<void> {
    await this.startMagiWithInquiry();
  }

  async startMagiWithInquiry(): Promise<void> {
    // Check if orchestrator is available
    if (!this.isOrchestratorAvailable) {
      this.serverLogs.push('[CLIENT] Cannot start Magi: Orchestrator is not available');
      return;
    }
    
    if (this.isMagiStarting) {
      return;
    }
    
    // Resume audio context for browsers that require user interaction
    await this.audioService.resumeAudioContext();
    
    // Reset audio queue for new deliberation
    this.audioService.resetAudioQueue();
    
    this.isMagiStarting = true;
    this.serverLogs.push(`[CLIENT] Starting Magi with inquiry: ${this.userInquiry || 'none'}`);
    this.websocketService.startConnecting(true, this.userInquiry);
    this.userInquiry = ''; // Clear the input field
    
    // Trigger immediate health check to get latest status
    this.performHealthCheck();
  }

  submitQuestion(): void {
    this.startMagiWithInquiry(); 
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
