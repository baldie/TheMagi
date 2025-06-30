// A simple subject-like class to stream logs without using full RxJS
type LogListener = (message: string) => void;

class LogStream {
  private listeners: LogListener[] = [];

  subscribe(listener: LogListener): void {
    this.listeners.push(listener);
  }

  unsubscribe(listener: LogListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  emit(message: string): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

export const logStream = new LogStream(); 