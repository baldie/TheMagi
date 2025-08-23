/**
 * Simple logger interface for the message queue service
 */
export interface ILogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: unknown): void;
}

/**
 * Console-based logger implementation
 */
class ConsoleLogger implements ILogger {
  private log(level: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data !== undefined) {
      console.log(logMessage);
      console.dir(data, { depth: null });
    } else {
      console.log(logMessage);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('WARN', message, data);
  }

  error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ERROR] ${message}`;
    
    console.log(logMessage);
    
    if (error instanceof Error) {
      console.error(error.stack);
    } else if (error !== undefined) {
      console.error('Additional error details:', error);
    }
  }
}

// Export a singleton instance
export const logger = new ConsoleLogger();