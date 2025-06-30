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
    const scriptPath = path.resolve(process.cwd(), 'start-magi.bat');
    console.log(`Executing: ${scriptPath}`);

    // --- Log file setup ---
    const logDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    const logFile = path.join(logDir, 'magi-startup.log');
    // 'a' mode appends to the file. This creates a running history.
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    logStream.write(`\n\n--- New Magi Startup initiated at ${new Date().toISOString()} ---\n`);

    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: [ 'ignore', logStream, logStream ], // Redirect stdout and stderr to the log stream
      shell: true
    });

    child.on('error', (error) => {
      console.error('Spawn error:', error);
      logStream.write(`\n--- SPAWN ERROR: ${error.message} ---\n`);
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