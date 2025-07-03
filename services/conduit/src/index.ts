import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';

const MAGI_CONDUIT_URL = 'http://127.0.0.1:11434';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensures the Magi Conduit service is running before the application proceeds.
 * It checks for the service, and if not found, starts it programmatically.
 */
export async function ensureMagiConduitIsRunning() {
  try {
    await axios.get(MAGI_CONDUIT_URL);
    console.info('Magi Conduit service is already running.');
    return;
  } catch (error) {
    console.info('Magi Conduit service not detected. Attempting to start it programmatically...');

    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const modelsPath = path.join(projectRoot, '.models');
    // Prepare for shell command by escaping backslashes for the path
    const wslModelsPath = modelsPath.replace(/\\/g, '\\\\');

    // Command to kill any old processes and then start the server
    const killCommand = 'pkill -9 ollama 2>/dev/null || true';
    const startCommand = `export OLLAMA_MODELS=$(wslpath '${wslModelsPath}'); /snap/bin/ollama serve`;
    const fullCommand = `${killCommand} && ${startCommand}`;

    const magiConduitProcess = spawn('wsl.exe', ['-e', 'bash', '-c', fullCommand], {
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
        console.info(`Waiting for Magi Conduit service... (${retries} retries left)`);
      }
    }
    throw new Error('Failed to start and connect to the Magi Conduit service.');
  }
}

export * from './service'; 