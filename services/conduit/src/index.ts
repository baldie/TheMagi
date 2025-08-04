import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const MAGI_CONDUIT_URL = 'http://127.0.0.1:11434';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensures the Magi Conduit service is running before the application proceeds.
 * It checks for the service, and if not found, starts it programmatically.
 */
export async function ensureMagiConduitIsRunning() {
  let serviceIsRunning = false;
  try {
    await axios.get(MAGI_CONDUIT_URL);
    console.info('Magi Conduit service is already running.');
    serviceIsRunning = true;
  } catch {
    console.info('Magi Conduit service not detected. Attempting to start it programmatically...');
  }

  if (!serviceIsRunning) {
    try {
      const logDir = path.resolve(__dirname, '..', 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, 'conduit.log');
      const wslLogFile = logFile.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, (match, p1) => `/mnt/${p1.toLowerCase()}`);

      const projectRoot = path.resolve(__dirname, '..', '..', '..', '..', 'TheMagi');
      const modelsPath = path.join(projectRoot, '.models');
      const wslModelsPath = modelsPath.replace(/\\/g, '\\\\');

      const localOllamaPath = path.join(projectRoot, 'services', 'conduit', 'CUDA', 'bin', 'ollama');
      const wslLocalOllamaPath = localOllamaPath.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, (match, p1) => `/mnt/${p1.toLowerCase()}`);
      
      const killCommand = 'pkill -9 ollama 2>/dev/null || true';
      const startCommand = `export OLLAMA_MODELS=$(wslpath '${wslModelsPath}'); ${wslLocalOllamaPath} serve > '${wslLogFile}' 2>&1`;
      const fullCommand = `${killCommand} && ${startCommand}`;

      const wslPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\wsl.exe' : 'wsl';
      const magiConduitProcess = spawn(wslPath, ['-e', 'bash', '-c', fullCommand], {
        detached: true,
        stdio: 'ignore',
      });

      magiConduitProcess.unref();
      console.info('Magi Conduit service starting in the background...');

      // Poll the service to see when it's ready
      let retries = 15; // ~30 seconds
      while (retries > 0) {
        await sleep(2000);
        try {
          await axios.get(MAGI_CONDUIT_URL);
          console.info('Magi Conduit service started successfully.');
          return;
        } catch (e) {
          retries--;
          console.info(`${e}`);
          console.info(`Waiting for Magi Conduit service... (${retries} retries left)`);
        }
      }
    }
    catch(error) {
      throw new Error(`Failed to start and connect to the Magi Conduit service: ${error}`);
    }
  }
}

 