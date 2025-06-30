import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Subject, Observable, timer } from 'rxjs';
import { retryWhen, delay, take } from 'rxjs/operators';

export interface WebSocketMessage {
  type: string;
  data: any;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService implements OnDestroy {
  private socket$: WebSocketSubject<WebSocketMessage> | null = null;
  private logSubject = new Subject<string>();
  private processStatusSubject = new Subject<boolean>();
  private readonly WS_ENDPOINT = 'ws://localhost:8080';
  private readonly RECONNECT_INTERVAL = 2000;
  private readonly MAX_RETRIES = 3;

  public logs$: Observable<string> = this.logSubject.asObservable();
  public isProcessRunning$: Observable<boolean> = this.processStatusSubject.asObservable();

  constructor() {
    this.logSubject.next('[CLIENT] WebSocketService constructed.');
  }

  ngOnDestroy(): void {
    this.logSubject.next('[CLIENT] WebSocketService being destroyed. Disconnecting.');
    this.disconnect();
  }

  public startConnecting(): void {
    this.logSubject.next(`[CLIENT] startConnecting() called. Attempting to connect to ${this.WS_ENDPOINT}...`);
    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket({
        url: this.WS_ENDPOINT,
        openObserver: {
          next: () => {
            this.logSubject.next('[CLIENT] WebSocket connection established.');
          }
        },
        closeObserver: {
          next: () => {
            this.logSubject.next('[CLIENT] WebSocket connection closed.');
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
        next: (msg) => this.handleMessage(msg),
        error: (err) => {
          const errorMsg = this.formatError(err);
          this.logSubject.next(`[CLIENT] WebSocket Error: ${errorMsg}`);
          this.processStatusSubject.next(false);
        },
        complete: () => {
          this.logSubject.next('[CLIENT] WebSocket connection path has completed. This may be due to max retries being reached.');
          this.processStatusSubject.next(false);
        }
      });
    }
  }

  private formatError(error: any): string {
    if (error instanceof Event) {
      return 'A connection error occurred. Is the orchestrator server running?';
    }
    if (error instanceof ErrorEvent) {
      return error.message;
    }
    if (error instanceof CloseEvent) {
      return `Connection closed with code ${error.code}: ${error.reason}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private handleMessage(msg: WebSocketMessage): void {
    this.logSubject.next(`[CLIENT] Received message: ${JSON.stringify(msg)}`);
    try {
      switch (msg.type) {
        case 'log':
          this.logSubject.next(msg.data);
          break;
        case 'PROCESS_EXITED':
          this.logSubject.next(msg.data);
          this.processStatusSubject.next(false);
          break;
        default:
          this.logSubject.next(`[CLIENT] Unknown message type: ${msg.type}`);
      }
    } catch (error) {
      this.logSubject.next(`[CLIENT] Error handling message: ${this.formatError(error)}`);
    }
  }

  public startMagi(): void {
    this.logSubject.next('[CLIENT] startMagi() called.');
    try {
      if (!this.socket$ || this.socket$.closed) {
        this.logSubject.next('[CLIENT] WebSocket is not connected. Aborting startMagi(). Connection attempts will continue in the background.');
        return;
      }
      
      const message: WebSocketMessage = { type: 'start-magi', data: null };
      this.logSubject.next(`[CLIENT] Sending message: ${JSON.stringify(message)}`);
      this.processStatusSubject.next(true);
      this.socket$.next(message);
    } catch (error) {
      const errorMsg = this.formatError(error);
      this.logSubject.next(`[CLIENT] Failed to start Magi: ${errorMsg}`);
      this.processStatusSubject.next(false);
    }
  }

  public disconnect(): void {
    this.logSubject.next('[CLIENT] Disconnect called.');
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
  }
} 