import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Subject, Observable, BehaviorSubject } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class WebsocketService implements OnDestroy {
  private readonly connectionStatusSubject = new BehaviorSubject<boolean>(false);
  public connectionStatus$ = this.connectionStatusSubject.asObservable();
  private socket$: WebSocketSubject<WebSocketMessage> | null = null;
  private readonly logSubject = new Subject<string>();
  private readonly processStatusSubject = new Subject<boolean>();
  private readonly audioSubject = new Subject<AudioMessage>();
  private readonly WS_ENDPOINT = 'ws://localhost:8080';
  private isConnecting = false;

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

  public startConnecting(shouldStartMagi = false, message?: string): void {
    // Prevent concurrent connection attempts
    if (this.isConnecting) {
      this.logSubject.next('[CLIENT] Connection already in progress');
      return;
    }
    
    // If already connected, just start magi if requested
    if (this.socket$ && !this.socket$.closed) {
      this.logSubject.next('[CLIENT] WebSocket already connected');
      if (shouldStartMagi) {
        this.contactMagi(message);
      }
      return;
    }

    this.isConnecting = true;
    this.logSubject.next(`[CLIENT] Connecting to ${this.WS_ENDPOINT}...`);
    
    this.socket$ = webSocket({
      url: this.WS_ENDPOINT,
      openObserver: {
        next: () => {
          this.isConnecting = false;
          this.connectionStatusSubject.next(true);
          this.logSubject.next('[CLIENT] WebSocket connected');
          if (shouldStartMagi) {
            this.contactMagi(message);
          }
        }
      },
      closeObserver: {
        next: (event) => {
          this.logSubject.next(`[CLIENT] WebSocket closed (${event.code})`);
          this.resetConnectionState();
        }
      }
    });

    this.socket$.subscribe({
      next: (msg) => this.handleMessage(msg),
      error: (err) => {
        this.logSubject.next(`[CLIENT] WebSocket error: ${this.formatError(err)}`);
        this.resetConnectionState();
      },
      complete: () => {
        this.logSubject.next('[CLIENT] WebSocket connection completed');
        this.resetConnectionState();
      }
    });
  }

  private resetConnectionState(): void {
    this.connectionStatusSubject.next(false);
    this.processStatusSubject.next(false);
    this.isConnecting = false;
  }

  private formatError(error: Error | Event | CloseEvent | ErrorEvent | unknown): string {
    if (error instanceof CloseEvent) {
      const reasonPart = error.reason ? ': ' + error.reason : '';
      return `Connection closed (${error.code}${reasonPart})`;
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
        case 'deliberation-complete':
        case 'deliberation-error':
          this.logSubject.next(msg.data as string);
          this.processStatusSubject.next(false);
          break;
        case 'audio':
          this.audioSubject.next(msg.data as AudioMessage);
          break;
        case 'ack':
            break;
        default:
          this.logSubject.next(`[CLIENT] Unknown message type: ${msg.type}`);
      }
    } catch (error) {
      this.logSubject.next(`[CLIENT] Error handling message: ${this.formatError(error)}`);
    }
  }

  public contactMagi(message?: string): void {
    try {
      if (!this.socket$ || this.socket$.closed) {
        this.logSubject.next('[CLIENT] WebSocket not connected - cannot contact Magi');
        return;
      }
      
      const wsMessage: WebSocketMessage = { type: 'contact-magi', data: { message } };
      this.processStatusSubject.next(true);
      this.socket$.next(wsMessage);
    } catch (error) {
      const errorMsg = this.formatError(error);
      this.logSubject.next(`[CLIENT] Failed to contact Magi: ${errorMsg}`);
      this.processStatusSubject.next(false);
    }
  }

  public disconnect(): void {
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
    this.resetConnectionState();
  }

  public resetConnection(): void {
    this.logSubject.next('[CLIENT] Resetting connection state');
    this.disconnect();
  }

  public isConnected(): boolean {
    return this.connectionStatusSubject.value;
  }
}