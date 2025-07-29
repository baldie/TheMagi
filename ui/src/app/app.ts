import { Component, OnInit, OnDestroy, inject } from '@angular/core';
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
import { LogsPanelComponent, LogEntry } from './components/logs-panel.component';
import { LogDetailPanelComponent } from './components/log-detail-panel.component';

const DO_NOT_START_MAGI = false;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, BalthasarComponent, CasperComponent, MelchiorComponent, LogsPanelComponent, LogDetailPanelComponent]
})

export class AppComponent implements OnInit, OnDestroy {
  
  balthasarStatus: MagiStatus = 'offline';
  casperStatus: MagiStatus = 'offline';
  melchiorStatus: MagiStatus = 'offline';
  displayLogs = false;
  isMagiStarting = false;
  serverLogs: LogEntry[] = [];
  selectedLogEntry: LogEntry | null = null;
  showLogDetail = false;
  userInquiry = '';
  isOrchestratorAvailable = false;
  orchestratorStatus: 'available' | 'busy' | 'error' = 'error';

  private subscriptions = new Subscription();
  private readonly ORCHESTRATOR_HEALTH_URL = 'http://localhost:8080/health';

  private audioService = inject(AudioService);
  private websocketService = inject(WebsocketService);
  private http = inject(HttpClient);

  ngOnInit(): void {
    // Subscribe to all WebSocket service observables
    this.subscriptions.add(this.websocketService.isProcessRunning$.subscribe(isRunning => this.isMagiStarting = isRunning));
    this.subscriptions.add(this.websocketService.logs$.subscribe(log => this.serverLogs.push(this.createLogEntry(log))));
    this.subscriptions.add(this.websocketService.audio$.subscribe(audioMessage => this.audioService.playAudioMessage(audioMessage)));
    this.subscriptions.add(timer(0, 5000).subscribe(() => this.performHealthCheck()));
  }

  private connectWebSocket(): void {
    this.serverLogs.push(this.createLogEntry('[CLIENT] Initiating WebSocket connection to Orchestrator...'));
    this.websocketService.startConnecting(DO_NOT_START_MAGI);
  }

  private updateHealthStatus(response: MagiHealth): void {
    this.isOrchestratorAvailable = response.status === 'available';
    this.orchestratorStatus = response.status;
    
    const {balthazar, caspar, melchior} = response.magi;
    this.balthasarStatus = balthazar.status;
    this.casperStatus = caspar.status;
    this.melchiorStatus = melchior.status;

    // Stop showing "starting" when all Magi are available
    const allMagiAvailable = [balthazar.status, caspar.status, melchior.status].every(status => status === 'available');
    if (this.isOrchestratorAvailable && allMagiAvailable) {
      this.isMagiStarting = false;
    }
  }

  private updateHealthStatusOnError(error: Error): void {
    // Set everything to offline/error state
    this.isOrchestratorAvailable = false;
    this.orchestratorStatus = 'error';
    this.balthasarStatus = this.casperStatus = this.melchiorStatus = 'offline';
    
    this.websocketService.disconnect();
    this.serverLogs.push(this.createLogEntry(`[CLIENT] Orchestrator health check failed: ${error.message || 'Unknown error'}`));
  }

  private handleWebSocketConnection(): void {
    const isWebSocketConnected = this.websocketService.isConnected();
    
    if (this.isOrchestratorAvailable && !isWebSocketConnected) {
      // Reset connection state when orchestrator becomes available again
      // This allows fresh reconnection attempts after server recovery
      this.websocketService.resetConnection();
      this.connectWebSocket();
    }
  }

  private performHealthCheck(): void {
    this.http.get<MagiHealth>(this.ORCHESTRATOR_HEALTH_URL).subscribe({
      next: (response) => {
        this.updateHealthStatus(response);
        this.handleWebSocketConnection();
      },
      error: (error) => this.updateHealthStatusOnError(error)
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.websocketService.disconnect();
  }

  async startMagi(): Promise<void> {
    // Check if orchestrator is available
    if (!this.isOrchestratorAvailable) {
      this.serverLogs.push(this.createLogEntry('[CLIENT] Cannot start Magi: Orchestrator is not available'));
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
    this.serverLogs.push(this.createLogEntry(`[CLIENT] Starting Magi with inquiry: ${this.userInquiry || 'none'}`));
    this.websocketService.startConnecting(true, this.userInquiry);
    this.userInquiry = ''; // Clear the input field
    
    // Trigger immediate health check to get latest status
    this.performHealthCheck();
  }

  submitQuestion(): void {
    this.startMagi(); 
  }

  toggleDisplayLogs() {
    this.displayLogs = !this.displayLogs;
    // Close log detail panel when hiding logs
    if (!this.displayLogs) {
      this.closeLogDetail();
    }
  }

  onLogSelected(log: LogEntry) {
    this.selectedLogEntry = log;
    this.showLogDetail = true;
  }

  closeLogDetail() {
    this.selectedLogEntry = null;
    this.showLogDetail = false;
  }

  clearLogs() {
    this.serverLogs = [];
    this.closeLogDetail();
  }

  private createLogEntry(message: string): LogEntry {
    // Extract log level from message if present
    let logType: 'INFO' | 'DEBUG' | 'ERROR' | 'WARN' = 'INFO';
    
    if (message.includes('[ERROR]') || message.toLowerCase().includes('error')) {
      logType = 'ERROR';
    } else if (message.includes('[WARN]') || message.toLowerCase().includes('warn')) {
      logType = 'WARN';
    } else if (message.includes('[DEBUG]') || message.toLowerCase().includes('debug')) {
      logType = 'DEBUG';
    }

    // Clean the message by removing timestamp and log level markers
    let cleanMessage = message;
    
    // Remove ISO timestamp pattern [2025-07-28T02:22:48.764Z]
    cleanMessage = cleanMessage.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s*/, '');
    
    // Remove other common timestamp patterns (e.g., "2024-01-01 12:34:56" or "[12:34:56]")
    cleanMessage = cleanMessage.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.\d]*\s*/, '');
    cleanMessage = cleanMessage.replace(/^\[\d{2}:\d{2}:\d{2}[.\d]*\]\s*/, '');
    
    // Remove log level markers
    cleanMessage = cleanMessage.replace(/^\[?(INFO|DEBUG|ERROR|WARN)\]?\s*:?\s*/i, '');
    
    // Trim any remaining whitespace
    cleanMessage = cleanMessage.trim();

    // Create title (first 100 characters with ellipsis)
    const title = cleanMessage.length > 100 ? cleanMessage.substring(0, 100) + '...' : cleanMessage;

    return {
      title,
      fullText: message,
      timeStamp: new Date(),
      logType
    };
  }
}
