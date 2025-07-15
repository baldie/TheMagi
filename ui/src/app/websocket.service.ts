import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Subject, Observable, BehaviorSubject } from 'rxjs';
import { retryWhen, delay, take } from 'rxjs/operators';

export interface WebSocketMessage {
  type: string;
  data: unknown;
}

export interface AudioMessage {
  audio: string; // base64 encoded audio data
  persona: string;
  isComplete: boolean;
  sequenceNumber: number;
}

interface WebSocketReadyState {
  readyState: number;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService implements OnDestroy {
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);
  public connectionStatus$ = this.connectionStatusSubject.asObservable();
  private socket$: WebSocketSubject<WebSocketMessage> | null = null;
  private logSubject = new Subject<string>();
  private processStatusSubject = new Subject<boolean>();
  private audioSubject = new Subject<AudioMessage>();
  private readonly WS_ENDPOINT = 'ws://localhost:8080';
  private readonly RECONNECT_INTERVAL = 2000;
  private readonly MAX_RETRIES = 3;
  private connectionAttempts = 0;

  public logs$: Observable<string> = this.logSubject.asObservable();
  public isProcessRunning$: Observable<boolean> = this.processStatusSubject.asObservable();
  public audio$: Observable<AudioMessage> = this.audioSubject.asObservable();

  constructor() {
    this.logSubject.next('[CLIENT] WebSocketService constructed.');
  }

  ngOnDestroy(): void {
    this.logSubject.next('[CLIENT] WebSocketService being destroyed. Disconnecting.');
    this.disconnect();
  }

  public startConnecting(shouldStartMagi = false, inquiry?: string): void {
    this.logSubject.next(`[CLIENT] startConnecting() called. shouldStartMagi: ${shouldStartMagi}, inquiry: ${inquiry || 'none'}`);
    this.logSubject.next(`[CLIENT] Attempting to connect to ${this.WS_ENDPOINT}...`);
    this.logSubject.next(`[CLIENT] Current socket state: ${this.socket$ ? (this.socket$.closed ? 'closed' : 'open') : 'null'}`);
    
    if (!this.socket$ || this.socket$.closed) {
      this.connectionAttempts++;
      this.logSubject.next(`[CLIENT] Creating new WebSocket connection... (attempt ${this.connectionAttempts})`);
      this.socket$ = webSocket({
        url: this.WS_ENDPOINT,
        openObserver: {
          next: (event) => {
            this.connectionAttempts = 0;
            this.connectionStatusSubject.next(true);
            this.logSubject.next('[CLIENT] WebSocket connection established');
            if (shouldStartMagi) {
              this.logSubject.next('[CLIENT] Starting Magi as requested...');
              this.startMagi(inquiry);
            }
          }
        },
        closeObserver: {
          next: (event) => {
            this.connectionStatusSubject.next(false);
            this.logSubject.next(`[CLIENT] WebSocket connection closed (${event.code}: ${event.reason || 'No reason'})`);
            this.processStatusSubject.next(false);
            // This will be handled by the retryWhen operator's completion
          }
        }
      });

      this.socket$.pipe(
        retryWhen(errors =>
          errors.pipe(
            delay(this.RECONNECT_INTERVAL),
            take(this.MAX_RETRIES)
          )
        )
      ).subscribe({
        next: (msg) => {
          this.handleMessage(msg);
        },
        error: (err) => {
          const errorMsg = this.formatError(err);
          this.logSubject.next(`[CLIENT] WebSocket Error: ${errorMsg}`);
          this.processStatusSubject.next(false);
        },
        complete: () => {
          this.logSubject.next('[CLIENT] WebSocket connection completed');
          this.processStatusSubject.next(false);
        }
      });
    } else {
      this.logSubject.next('[CLIENT] WebSocket already connected');
      if (shouldStartMagi) {
        this.logSubject.next('[CLIENT] Starting Magi on existing connection...');
        this.startMagi(inquiry);
      }
    }
  }

  private formatError(error: Error | Event | CloseEvent | ErrorEvent | unknown): string {
    if (error instanceof CloseEvent) {
      return `Connection closed (${error.code}${error.reason ? `: ${error.reason}` : ''})`;
    }
    if (error instanceof Event) {
      return 'Network error - check if orchestrator server is running';
    }
    if (error instanceof ErrorEvent) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return `Unknown error: ${String(error)}`;
  }

  private handleMessage(msg: WebSocketMessage): void {
    try {
      switch (msg.type) {
        case 'log':
          this.logSubject.next(msg.data as string);
          break;
        case 'PROCESS_EXITED':
          this.logSubject.next(msg.data as string);
          this.processStatusSubject.next(false);
          break;
        case 'deliberation-complete':
          this.logSubject.next(msg.data as string);
          this.processStatusSubject.next(false);
          break;
        case 'deliberation-error':
          this.logSubject.next(msg.data as string);
          this.processStatusSubject.next(false);
          break;
        case 'audio':
          this.audioSubject.next(msg.data as AudioMessage);
          break;
        default:
          this.logSubject.next(`[CLIENT] Unknown message type: ${msg.type}`);
      }
    } catch (error) {
      this.logSubject.next(`[CLIENT] Error handling message: ${this.formatError(error)}`);
    }
  }

  public startMagi(inquiry?: string): void {
    try {
      if (!this.socket$ || this.socket$.closed) {
        this.logSubject.next('[CLIENT] WebSocket not connected - cannot start Magi');
        return;
      }
      
      const message: WebSocketMessage = { type: 'start-magi', data: { inquiry } };
      this.processStatusSubject.next(true);
      this.socket$.next(message);
      this.logSubject.next('[CLIENT] Starting Magi deliberation...');
    } catch (error) {
      const errorMsg = this.formatError(error);
      this.logSubject.next(`[CLIENT] Failed to start Magi: ${errorMsg}`);
      this.processStatusSubject.next(false);
    }
  }

  public disconnect(): void {
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
  }

  public isConnected(): boolean {
    return this.connectionStatusSubject.value;
  }
}