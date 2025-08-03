import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface LogEntry {
  title: string;
  fullText: string;
  timeStamp: Date;
  logType: 'INFO' | 'DEBUG' | 'ERROR' | 'WARN';
}

@Component({
  selector: 'app-logs-panel',
  templateUrl: './logs-panel.component.html',
  styleUrls: ['./logs-panel.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class LogsPanelComponent implements AfterViewChecked {
  @ViewChild('logsContainer') logsContainer!: ElementRef<HTMLDivElement>;
  
  @Input() displayLogs = false;
  @Input() serverLogs: LogEntry[] = [];
  @Output() clearLogsEvent = new EventEmitter<void>();
  @Output() logSelected = new EventEmitter<LogEntry>();

  selectedLogIndex: number | null = null;
  private isUserScrolling = false;
  private shouldAutoScroll = true;

  ngAfterViewChecked() {
    if (this.shouldAutoScroll && this.displayLogs && this.logsContainer) {
      this.scrollToBottom();
    }
  }

  onLogsScroll() {
    if (!this.logsContainer) return;
    
    const element = this.logsContainer.nativeElement;
    const tolerance = 10;
    
    const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - tolerance;
    
    this.shouldAutoScroll = isNearBottom;
    
    this.isUserScrolling = true;
    setTimeout(() => {
      this.isUserScrolling = false;
    }, 150);
  }

  clearLogs() {
    this.clearLogsEvent.emit();
    this.selectedLogIndex = null;
  }

  selectLog(index: number) {
    this.selectedLogIndex = index;
    const selectedLog = this.serverLogs[index];
    if (selectedLog) {
      this.logSelected.emit(selectedLog);
    }
  }

  formatTime(timeStamp: Date): string {
    const hours24 = timeStamp.getHours();
    const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const minutes = timeStamp.getMinutes().toString().padStart(2, '0');
    const seconds = timeStamp.getSeconds().toString().padStart(2, '0');
    const milliseconds = timeStamp.getMilliseconds().toString().padStart(3, '0');
    return `${hours12}:${minutes}:${seconds}.${milliseconds} ${ampm}`;
  }

  private scrollToBottom() {
    if (!this.logsContainer || this.isUserScrolling) return;
    
    try {
      const element = this.logsContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    } catch {
      // Ignore scroll errors
    }
  }
}