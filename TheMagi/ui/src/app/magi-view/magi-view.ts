import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-magi-view',
  standalone: false,
  templateUrl: './magi-view.html',
  styleUrl: './magi-view.scss'
})
export class MagiView implements OnInit {
  balthasarStatus: string = 'off';
  casperStatus: string = 'off';
  melchiorStatus: string = 'off';
  advancedMode: boolean = false;

  private statuses = ['off', 'loading', 'ready', 'thinking', 'error'];
  private statusIndex = 0;

  ngOnInit(): void {
    this.startStatusCycle();
  }

  toggleAdvancedMode(): void {
    this.advancedMode = !this.advancedMode;
  }

  private startStatusCycle(): void {
    setInterval(() => {
      this.statusIndex = (this.statusIndex + 1) % this.statuses.length;
      const newStatus = this.statuses[this.statusIndex];
      this.balthasarStatus = newStatus;

      // Stagger the other two for more dynamic feel
      setTimeout(() => {
        this.casperStatus = newStatus;
      }, 500);
      setTimeout(() => {
        this.melchiorStatus = newStatus;
      }, 1000);

    }, 2000);
  }
}
