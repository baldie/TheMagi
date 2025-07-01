import express, { Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import cors from 'cors';
import fs from 'fs';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.post('/start', (req: Request, res: Response) => {
  console.log('Received /start request. Attempting to execute start-magi.bat');
  
  try {
    // Go up one directory from the launcher directory to find start-magi.bat
    const scriptPath = path.resolve(__dirname, '../../start-magi.bat');
    console.log(`Executing: ${scriptPath}`);

    // --- Log file setup ---
    const logDir = path.resolve(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'magi-startup.log');
    
    // Open the log file for appending
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Write startup header to log
    const startupHeader = `\n\n--- New Magi Startup initiated at ${new Date().toISOString()} ---\n`;
    fs.appendFileSync(logFile, startupHeader);

    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], // Use pipe instead of direct stream
      shell: true,
      cwd: path.dirname(scriptPath) // Set working directory to script location
    });

    // Pipe the output to both console and log file
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.stdout.on('data', (data) => {
      console.log(`[Magi] ${data}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[Magi Error] ${data}`);
    });

    child.on('error', (error) => {
      const errorMsg = `\n--- SPAWN ERROR: ${error.message} ---\n`;
      console.error('Spawn error:', error);
      fs.appendFileSync(logFile, errorMsg);
    });

    child.unref();

    console.log(`Successfully started start-magi.bat. Output is being logged to ${logFile}`);
    res.status(200).send({ message: 'Magi start process initiated.' });
  } catch (error) {
    const castError = error as Error;
    console.error('Failed to start start-magi.bat:', castError.message);
    res.status(500).send({ message: 'Failed to initiate Magi start process.' });
  }
});

app.listen(port, () => {
  console.log(`Magi Launcher service listening on http://localhost:${port}`);
}); 