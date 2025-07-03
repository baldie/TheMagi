import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Subject, Observable, timer } from 'rxjs';
import { retryWhen, delay, take } from 'rxjs/operators';

export interface WebSocketMessage {
  type: string;
  data: any;
}

export interface AudioMessage {
  audio: string; // base64 encoded audio data
  persona: string;
  isComplete: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService implements OnDestroy {
  private socket$: WebSocketSubject<WebSocketMessage> | null = null;
  private logSubject = new Subject<string>();
  private processStatusSubject = new Subject<boolean>();
  private audioSubject = new Subject<AudioMessage>();
  private readonly WS_ENDPOINT = 'ws://localhost:8080';
  private readonly RECONNECT_INTERVAL = 2000;
  private readonly MAX_RETRIES = 3;

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

  public startConnecting(shouldStartMagi: boolean = false, inquiry?: string): void {
    this.logSubject.next(`[CLIENT] startConnecting() called. Attempting to connect to ${this.WS_ENDPOINT}...`);
    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket({
        url: this.WS_ENDPOINT,
        openObserver: {
          next: () => {
            this.logSubject.next('[CLIENT] WebSocket connection established.');
            if (shouldStartMagi) {
              this.startMagi(inquiry);
            }
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
    if (error instanceof CloseEvent) {
      let reasonMessage: string;
      switch (error.code) {
        case 1000:
          reasonMessage = "Normal closure, meaning that the purpose for which the connection was established has been fulfilled.";
          break;
        case 1001:
          reasonMessage = "An endpoint is 'going away', such as a server going down or a browser having navigated away from a page.";
          break;
        case 1002:
          reasonMessage = "The endpoint is terminating the connection due to a protocol error.";
          break;
        case 1006:
          reasonMessage = "The connection was closed abnormally (e.g., without sending or receiving a Close control frame). Check the server logs, it might have crashed.";
          break;
        case 1011:
          reasonMessage = "The server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.";
          break;
        default:
          reasonMessage = "The connection was closed for an unknown reason.";
      }
      return `Connection closed with code ${error.code}. Reason: ${reasonMessage} ${error.reason ? `(${error.reason})` : ''}`;
    }
    if (error instanceof Event) {
      return 'A network error occurred, preventing the connection from being established. Is the orchestrator server running and accessible?';
    }
    if (error instanceof ErrorEvent) {
      return `An error occurred: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return `An unknown error occurred: ${String(error)}`;
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
    this.logSubject.next('[CLIENT] startMagi() called.');
    try {
      if (!this.socket$ || this.socket$.closed) {
        this.logSubject.next('[CLIENT] WebSocket is not connected. Aborting startMagi(). Connection attempts will continue in the background.');
        return;
      }
      
      const message: WebSocketMessage = { type: 'start-magi', data: { inquiry } };
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