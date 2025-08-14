import type { LogLevel } from './config';
import { LOG_LEVELS } from './config';
import { logStream } from './log-stream';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const logDirectory = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

const getLogFileName = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}.log`;
};

// In integration tests, write to a per-run file shared by all child processes when possible
const IS_TEST_MODE = process.env.MAGI_TEST_MODE === 'true';

function resolveTestLogPath(): string {
  const explicitPath = process.env.MAGI_TEST_LOG_FILE;
  if (explicitPath && explicitPath.trim().length > 0) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.join(logDirectory, explicitPath);
  }
  const runId = process.env.MAGI_TEST_RUN_ID;
  const fileName = runId && runId.trim().length > 0
    ? `integration-${runId}.log`
    : `integration-${Date.now()}.log`;
  return path.join(logDirectory, fileName);
}

const logFilePath = IS_TEST_MODE ? resolveTestLogPath() : path.join(logDirectory, getLogFileName());
const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

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
    const logHeader = `[${timestamp}] [${level}]`;
    const plainMessage = `${logHeader} ${message}`;

    // Write to file stream (un-colored)
    fileStream.write(plainMessage + '\n');
    if (data) {
        fileStream.write(JSON.stringify(data, null, 2) + '\n');
    }

    // Emit to the stream for websockets (without color) unless running tests
    if (!IS_TEST_MODE) {
      logStream.emit(plainMessage);
    }

    // Apply colors for console output
    let logMessage = '';
    switch (level) {
      case LOG_LEVELS.ERROR:
        logMessage = chalk.red(`${logHeader} ${message}`);
        break;
      case LOG_LEVELS.INFO:
        if (message === '--- MAGI SYSTEM READY ---') {
          logMessage = chalk.green(`${logHeader} ${message}`);
        } else {
          logMessage = chalk.white(`${logHeader} ${message}`);
        }
        break;
      // For WARN and DEBUG, we'll just use the default console color.
    }

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
    const timestamp = new Date().toISOString();
    const logHeader = `[${timestamp}] [ERROR]`;
    const plainMessage = `${logHeader} ${message}`;

    // Write to file stream (un-colored)
    fileStream.write(plainMessage + '\n');

    // Emit to the stream for websockets (without color) unless running tests
    if (!IS_TEST_MODE) {
      logStream.emit(plainMessage);
    }

    // Console output with color
    console.log(chalk.red(plainMessage));

    if (error instanceof Error) {
      console.error(chalk.red(error.stack));
      fileStream.write(`${error.stack}\n`);
    } else if (error !== undefined) {
      console.error(chalk.red('Additional error details:'), error);
      fileStream.write(`${JSON.stringify(error, null, 2)}\n`);
    }
  }
}

// Export a singleton instance
export const logger = new Logger();

export function closeLogStream() {
  fileStream.end();
}
