import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogEntry } from './logs-panel.component';

@Component({
  selector: 'app-log-detail-panel',
  templateUrl: './log-detail-panel.component.html',
  styleUrls: ['./log-detail-panel.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class LogDetailPanelComponent {
  @Input() selectedLog: LogEntry | null = null;
  @Input() isVisible: boolean = false;
  @Output() closePanel = new EventEmitter<void>();
  
  copySuccess: boolean = false;

  onClose() {
    this.closePanel.emit();
  }

  formatTime(timeStamp: Date): string {
    const hours24 = timeStamp.getHours();
    let hours12: number;
    if (hours24 === 0) {
      hours12 = 12;
    } else if (hours24 > 12) {
      hours12 = hours24 - 12;
    } else {
      hours12 = hours24;
    }
    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const minutes = timeStamp.getMinutes().toString().padStart(2, '0');
    const seconds = timeStamp.getSeconds().toString().padStart(2, '0');
    const milliseconds = timeStamp.getMilliseconds().toString().padStart(3, '0');
    return `${hours12}:${minutes}:${seconds}.${milliseconds} ${ampm}`;
  }

  copyLogText() {
    if (this.selectedLog && this.selectedLog.fullText) {
      const cleanedText = this.removeLogPrefix(this.selectedLog.fullText);
      navigator.clipboard.writeText(cleanedText)
        .then(() => {
          console.log('Log text copied to clipboard');
          this.copySuccess = true;
          setTimeout(() => {
            this.copySuccess = false;
          }, 2000);
        });
    }
  }

  private removeLogPrefix(logText: string): string {
    // Remove pattern like: [2025-08-21T02:25:46.540Z] [DEBUG] ➡️🤖\n\n
    const prefixPattern = /^\[[^\]\r\n]{1,100}\]\s*\[[^\]\r\n]{1,100}\]\s*[^\r\n]{0,100}\n\n/;
    return logText.replace(prefixPattern, '');
  }
}