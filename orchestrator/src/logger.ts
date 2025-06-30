import { LOG_LEVELS, LogLevel } from './config';
import { logStream } from './log-stream';

/**
 * Custom logger for The Magi Orchestrator
 * Provides consistent formatting and timestamp-based logging
 */
class Logger {
  /**
   * Internal logging method that handles the core logging logic
   * @param level - The log level (DEBUG, INFO, ERROR)
   * @param message - The message to log
   * @param data - Optional data to include in the log
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    // Emit to the stream for websockets
    logStream.emit(logMessage);

    if (data !== undefined) {
      console.log(logMessage);
      console.dir(data, { depth: null });
    } else {
      console.log(logMessage);
    }
  }

  /**
   * Log debug level messages
   * @param message - The debug message
   * @param data - Optional data to include
   */
  debug(message: string, data?: unknown): void {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  /**
   * Log info level messages
   * @param message - The info message
   * @param data - Optional data to include
   */
  info(message: string, data?: unknown): void {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  /**
   * Log warning level messages
   * @param message - The warning message
   * @param data - Optional data to include
   */
  warn(message: string, data?: unknown): void {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  /**
   * Log error level messages
   * @param message - The error message
   * @param error - Optional error object or data to include
   */
  error(message: string, error?: unknown): void {
    this.log(LOG_LEVELS.ERROR, message);
    if (error instanceof Error) {
      console.error(error.stack);
    } else if (error !== undefined) {
      console.error('Additional error details:', error);
    }
  }
}

// Export a singleton instance
export const logger = new Logger();
