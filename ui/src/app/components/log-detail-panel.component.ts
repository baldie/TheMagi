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

  onClose() {
    this.closePanel.emit();
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
}