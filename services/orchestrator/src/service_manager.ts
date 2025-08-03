import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { logger, closeLogStream } from './logger';
import path from 'path';
import axios from 'axios';
import { TTS_API_BASE_URL } from './config';
import os from 'os';
import { ensureMagiConduitIsRunning } from '../../conduit/src/index';

const isWindows = os.platform() === 'win32';

class ServiceManager {
  private ttsProcess: ChildProcess | null = null;
  private uiProcess: ChildProcess | null = null;

  constructor() {
    // Ensure cleanup on process exit
    process.on('exit', () => {
      this.stopAllServices();
    });
    process.on('SIGINT', () => {
      this.stopAllServices();
      process.exit();
    });
  }
  
  private async waitForService(serviceName: string, healthUrl: string, maxAttempts: number = 60, delayMs: number = 2000): Promise<boolean> {
    logger.info(`Waiting for ${serviceName} to become healthy at ${healthUrl}...`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(healthUrl, { timeout: delayMs - 500 });

        if (serviceName === 'UI') {
            // For the UI service, we only need to confirm it's reachable.
            if (response.status === 200) {
                logger.info('UI service is ready.');
                return true;
            }
        } else {
            // For other services, we check the JSON response body.
            if (response.status === 200 && (response.data.status === 'healthy' || response.data.status === 'ok')) {
                logger.info(`${serviceName} is ready.`);
                return true;
            }
            logger.debug(`${serviceName} status is '${response.data.status}', waiting...`);
        }
      } catch {
        if (attempt === 1) {
            logger.info(`Waiting for ${serviceName} to launch (attempt ${attempt}/${maxAttempts})`);
        }
        if (attempt % 5 === 0) { // Log every 10 seconds
            logger.info(`Still waiting for ${serviceName} to launch (attempt ${attempt}/${maxAttempts})`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    logger.error(`${serviceName} failed to become ready after ${maxAttempts} attempts.`);
    return false;
  }

  private async startTTSServiceInternal(): Promise<void> {
    const healthUrl = `${TTS_API_BASE_URL}/health`;
    try {
        await axios.get(healthUrl, { timeout: 1000 });
        logger.info('TTS service is already running.');
        return;
    } catch {
        logger.info('TTS service not running. Starting it now...');
    }

    if (this.ttsProcess) {
        logger.info('TTS service is already starting.');
        return;
    }
    
    const ttsServiceDir = path.resolve(__dirname, '..', '..', '..', 'services', 'tts');
    const venvPath = isWindows ? 'venv/Scripts/python.exe' : 'venv/bin/python';
    const pythonPath = path.join(ttsServiceDir, venvPath);
    
    this.ttsProcess = spawn(
        pythonPath,
        ['-m', 'uvicorn', 'tts_server:app', '--host', '0.0.0.0', '--port', '8000'],
        {
            cwd: ttsServiceDir,
            stdio: ['ignore', 'pipe', 'pipe'], // stdin, stdout, stderr
            env: { 
                ...process.env, 
                PYTHONUNBUFFERED: "1",
                TQDM_DISABLE: "1",
                TRANSFORMERS_VERBOSITY: "error"
            }
        }
    );

    this.ttsProcess.stdout?.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
            if (line.trim().length > 0) {
                const trimmedLine = line.trim();
                // Only log important TTS messages as INFO, others as DEBUG
                if (trimmedLine.includes('TTS Service Starting Up') ||
                    trimmedLine.includes('loaded successfully') ||
                    trimmedLine.includes('ready to accept requests') ||
                    trimmedLine.includes('ERROR') ||
                    trimmedLine.includes('WARNING') ||
                    trimmedLine.includes('Failed') ||
                    trimmedLine.includes('startup completed')) {
                    logger.info(`[TTS] ${trimmedLine}`);
                } else {
                    logger.debug(`[TTS] ${trimmedLine}`);
                }
            }
        });
    });

    this.ttsProcess.stderr?.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
            if (line.trim().length > 0) {
                const trimmedLine = line.trim();
                // Check if this is actually an info message sent to stderr
                if (trimmedLine.includes('Application startup complete') || 
                    trimmedLine.includes('Uvicorn running on')) {
                    logger.info(`[TTS] ${trimmedLine}`);
                } else if (trimmedLine.includes('INFO:')) {
                    // Log most INFO messages as debug to reduce verbosity
                    logger.debug(`[TTS] ${trimmedLine}`);
                } else if (trimmedLine.includes('Sampling:') && trimmedLine.includes('it/s')) {
                    // Filter out sampling progress messages completely - they clutter the logs
                    return;
                } else {
                    logger.error(`[TTS STDERR] ${trimmedLine}`);
                }
            }
        });
    });

    this.ttsProcess.on('error', (err) => {
        logger.error(`Failed to start TTS service.`, err);
    });

    this.ttsProcess.on('exit', (code) => {
        logger.warn(`TTS service exited with code ${code}.`);
        this.ttsProcess = null;
    });
    
    await this.waitForService('TTS', healthUrl);
  }

  public async startTTSService() {
    await this.startTTSServiceInternal();
  }

  public async startConduitService() {
    logger.info('Ensuring Magi Conduit service is running...');
    try {
      await ensureMagiConduitIsRunning();
      logger.info('Magi Conduit service is ready.');
    } catch (error) {
      logger.error('Failed to start Magi Conduit service.', error);
      throw error; // Propagate the error to stop the startup process
    }
  }

  public async startUIService(): Promise<void> {
    const healthUrl = `http://localhost:4200`; // Angular dev server root
    try {
        await axios.get(healthUrl, { timeout: 1000 });
        logger.info('UI service is already running.');
        return;
    } catch {
        logger.info('UI service not running. Starting it now...');
    }

    if (this.uiProcess) {
        logger.info('UI service is already starting.');
        return;
    }

    const uiDir = path.resolve(__dirname, '..', '..', '..', 'ui');
    const command = isWindows ? 'npm.cmd' : 'npm';

    this.uiProcess = spawn(command, ['start'], {
        cwd: uiDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,
    });

    this.uiProcess.stdout?.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
            if (line.trim().length > 0) logger.info(`[UI] ${line.trim()}`);
        });
    });

    this.uiProcess.stderr?.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
            if (line.trim().length > 0) {
                const trimmedLine = line.trim();
                // Check if this is actually an info/progress message sent to stderr
                if (trimmedLine.includes('Generating browser application bundles') || 
                    trimmedLine.includes('Browser application bundle generation complete') ||
                    trimmedLine.includes('✔') || trimmedLine.includes('Local:') || 
                    trimmedLine.includes('Angular Live Development Server')) {
                    logger.info(`[UI] ${trimmedLine}`);
                } else if (trimmedLine.includes('ERROR') || trimmedLine.includes('FAILED') || 
                          trimmedLine.includes('error TS')) {
                    logger.error(`[UI ERROR] ${trimmedLine}`);
                } else {
                    logger.warn(`[UI] ${trimmedLine}`);
                }
            }
        });
    });

    this.uiProcess.on('error', (err) => {
        logger.error(`Failed to start UI service.`, err);
    });

    this.uiProcess.on('exit', (code) => {
        logger.warn(`UI service exited with code ${code}.`);
        this.uiProcess = null;
    });

    await this.waitForService('UI', healthUrl, 120); // Longer timeout for Angular builds
  }

  stopAllServices() {
    logger.info('Stopping all managed services...');
    if (this.ttsProcess) {
      this.ttsProcess.kill('SIGINT');
      this.ttsProcess = null;
    }
    if (this.uiProcess) {
        this.uiProcess.kill('SIGINT');
        this.uiProcess = null;
    }
    closeLogStream();
  }
}

export const serviceManager = new ServiceManager(); 