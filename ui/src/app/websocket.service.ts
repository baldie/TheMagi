import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Subject, Observable } from 'rxjs';
import { retryWhen, delay, take } from 'rxjs/operators';

export interface WebSocketMessage {
  type: string;
  data: unknown;
}

export interface AudioMessage {
  audio: string; // base64 encoded audio data
  persona: string;
  isComplete: boolean;
}

interface WebSocketReadyState {
  readyState: number;
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

  public startConnecting(shouldStartMagi: boolean = false, inquiry?: string): void {
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
            this.connectionAttempts = 0; // Reset on successful connection
            this.logSubject.next(`[CLIENT] WebSocket connection established successfully. Event: ${JSON.stringify(event)}`);
            const socket = ((this.socket$ as unknown) as { _socket?: WebSocketReadyState })?._socket;
            this.logSubject.next(`[CLIENT] WebSocket readyState: ${socket?.readyState ?? 'unknown'}`);
            if (shouldStartMagi) {
              this.logSubject.next('[CLIENT] Starting Magi as requested...');
              this.startMagi(inquiry);
            }
          }
        },
        closeObserver: {
          next: (event) => {
            this.logSubject.next(`[CLIENT] WebSocket connection closed. Event: ${JSON.stringify(event)}`);
            this.logSubject.next(`[CLIENT] Close code: ${event.code}, reason: ${event.reason || 'none'}, wasClean: ${event.wasClean}`);
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
          this.logSubject.next(`[CLIENT] WebSocket message received successfully`);
          this.handleMessage(msg);
        },
        error: (err) => {
          const errorMsg = this.formatError(err);
          this.logSubject.next(`[CLIENT] WebSocket Error occurred: ${errorMsg}`);
          this.logSubject.next(`[CLIENT] Error type: ${err.constructor.name}`);
          this.logSubject.next(`[CLIENT] Error details: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
          this.logSubject.next(`[CLIENT] Connection attempts so far: ${this.connectionAttempts}`);
          this.logSubject.next(`[CLIENT] Will retry after ${this.RECONNECT_INTERVAL}ms if retries remaining...`);
          this.processStatusSubject.next(false);
        },
        complete: () => {
          this.logSubject.next('[CLIENT] WebSocket connection path has completed. This may be due to max retries being reached.');
          this.logSubject.next(`[CLIENT] Final socket state: ${this.socket$ ? (this.socket$.closed ? 'closed' : 'open') : 'null'}`);
          this.processStatusSubject.next(false);
        }
      });
    } else {
      this.logSubject.next('[CLIENT] WebSocket already exists and is not closed. Skipping connection creation.');
      this.logSubject.next(`[CLIENT] Current socket state: ${this.socket$ ? (this.socket$.closed ? 'closed' : 'open') : 'null'}`);
      if (shouldStartMagi) {
        this.logSubject.next('[CLIENT] Starting Magi on existing connection...');
        this.startMagi(inquiry);
      }
    }
  }

  private formatError(error: Error | Event | CloseEvent | ErrorEvent | unknown): string {
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
          this.logSubject.next(msg.data as string);
          break;
        case 'PROCESS_EXITED':
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
    this.logSubject.next(`[CLIENT] startMagi() called with inquiry: ${inquiry || 'none'}`);
    this.logSubject.next(`[CLIENT] Socket state check: ${this.socket$ ? (this.socket$.closed ? 'closed' : 'open') : 'null'}`);
    
    try {
      if (!this.socket$ || this.socket$.closed) {
        this.logSubject.next('[CLIENT] WebSocket is not connected. Aborting startMagi(). Connection attempts will continue in the background.');
        this.logSubject.next(`[CLIENT] Socket details: exists=${!!this.socket$}, closed=${this.socket$?.closed}`);
        return;
      }
      
      this.logSubject.next('[CLIENT] WebSocket is connected, proceeding with message send...');
      const message: WebSocketMessage = { type: 'start-magi', data: { inquiry } };
      this.logSubject.next(`[CLIENT] Preparing to send message: ${JSON.stringify(message)}`);
      this.processStatusSubject.next(true);
      this.socket$.next(message);
      this.logSubject.next('[CLIENT] Message sent successfully');
    } catch (error) {
      const errorMsg = this.formatError(error);
      this.logSubject.next(`[CLIENT] Failed to start Magi: ${errorMsg}`);
      this.logSubject.next(`[CLIENT] Error occurred while sending message: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
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

  public isConnected(): boolean {
    return !!this.socket$ && !this.socket$.closed;
  }
}