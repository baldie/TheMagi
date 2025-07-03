import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger';
import path from 'path';
import axios from 'axios';
import { TTS_API_BASE_URL } from './config';
import os from 'os';

class ServiceManager {
  private ttsProcess: ChildProcess | null = null;
  private isStarting: boolean = false;

  constructor() {
    // Ensure cleanup on process exit
    process.on('exit', () => this.stopTTSService());
    process.on('SIGINT', () => {
      this.stopTTSService();
      process.exit();
    });
  }

  private async waitForTTSService(maxAttempts: number = 60, delayMs: number = 1000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${TTS_API_BASE_URL}/health`);
        if (response.data.status === 'healthy') {
          logger.info('TTS service is ready');
          return true;
        }
      } catch (error) {
        if (attempt === maxAttempts) {
          logger.error('TTS service failed to become ready', error);
          return false;
        }
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
  }

  async ensureTTSServiceRunning(): Promise<boolean> {
    try {
      // Check if service is already running
      try {
        const response = await axios.get(`${TTS_API_BASE_URL}/health`);
        if (response.data.status === 'healthy') {
          logger.info('TTS service is already running');
          return true;
        }
      } catch (error) {
        // Service is not running, continue to start it
      }

      // Prevent multiple simultaneous start attempts
      if (this.isStarting) {
        logger.info('TTS service is already starting');
        return await this.waitForTTSService();
      }

      this.isStarting = true;

      // Get the absolute path to the TTS service directory
      const ttsServiceDir = path.resolve(__dirname, '../../services/tts');
      
      try {
        // Determine the correct approach based on the OS
        const isWindows = os.platform() === 'win32';
        
        if (isWindows) {
          // On Windows, use cmd to run the batch file
          this.ttsProcess = spawn('cmd', ['/c', 'start_service.bat'], {
            cwd: ttsServiceDir,
            stdio: 'pipe',
            env: {
              ...process.env,
              PYTHONUNBUFFERED: '1',
            },
          });
        } else {
          // On Linux/WSL, use python directly
          this.ttsProcess = spawn('./venv/bin/python', ['-m', 'uvicorn', 'openvoice.openvoice_server:app', '--host', '0.0.0.0', '--port', '8000'], {
            cwd: ttsServiceDir,
            stdio: 'pipe',
            env: {
              ...process.env,
              PYTHONUNBUFFERED: '1',
            },
          });
        }

        // Handle process events
        this.ttsProcess.stdout?.on('data', (data) => {
          logger.debug(`TTS Service stdout: ${data}`);
        });

        this.ttsProcess.stderr?.on('data', (data) => {
          logger.debug(`TTS Service stderr: ${data}`);
        });

        this.ttsProcess.on('error', (error) => {
          logger.error('Failed to start TTS service', error);
          this.isStarting = false;
        });

        this.ttsProcess.on('exit', (code) => {
          logger.info(`TTS service exited with code ${code}`);
          this.ttsProcess = null;
          this.isStarting = false;
        });

        // Wait for the service to become ready
        const isReady = await this.waitForTTSService();
        this.isStarting = false;
        return isReady;

      } catch (spawnError) {
        logger.error('Failed to spawn TTS service process', spawnError);
        this.isStarting = false;
        return false;
      }

    } catch (error) {
      logger.error('Error ensuring TTS service is running', error);
      this.isStarting = false;
      return false;
    }
  }

  stopTTSService() {
    if (this.ttsProcess) {
      logger.info('Stopping TTS service');
      try {
        // Send SIGTERM first for graceful shutdown
        this.ttsProcess.kill('SIGTERM');
        
        // Set a timeout to force kill if graceful shutdown fails
        setTimeout(() => {
          if (this.ttsProcess) {
            this.ttsProcess.kill('SIGKILL');
            this.ttsProcess = null;
          }
        }, 5000); // 5 second timeout for graceful shutdown
      } catch (error) {
        logger.error('Error stopping TTS service', error);
        // Force kill as last resort
        if (this.ttsProcess) {
          this.ttsProcess.kill('SIGKILL');
          this.ttsProcess = null;
        }
      }
    }
  }
}

export const serviceManager = new ServiceManager(); 