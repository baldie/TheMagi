import { spawn } from 'child_process';
import axios from 'axios';
import os from 'os';
import path from 'path';
import { logger } from './logger';
import { MAGI_CONDUIT_API_BASE_URL, TTS_API_BASE_URL, REQUIRED_MODELS } from './config';
import { PERSONAS_CONFIG } from './magi/magi';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { mcpClientManager } from './mcp';
import { MagiName } from './magi/magi';

/**
 * Checks if a service is ready, attempts to start it if not, and polls for it to become available.
 * @param serviceName - The name of the service (e.g., "Magi Conduit").
 * @param healthUrl - The health check URL for the service.
 * @param startCommand - The command to execute to start the service.
 * @param maxRetries - The number of retry attempts.
 * @param initialDelay - The initial delay in ms for the backoff.
 */
async function ensureServiceReady(
  serviceName: string,
  healthUrl: string,
  startCommand: { cmd: string; args: string[]; options?: object },
  maxRetries: number = 5,
  initialDelay: number = 2000,
): Promise<void> {
  logger.info(`Ensuring ${serviceName} service is ready...`);
  logger.debug(`[${serviceName}] Health check URL: ${healthUrl}`);
  
  // First, perform a quick check to see if the service is already running.
  try {
    await axios.get(healthUrl, { timeout: 5000 });
    logger.info(`... ${serviceName} service is already running.`);
    return; // If it's running, we're done.
  } catch (e) {
    // Service is not ready, so we will proceed to start and poll.
    logger.info(`... ${serviceName} service not detected or not responding. Attempting to start and poll...`);
  }

  // Issue the start command.
  try {
    // Start the process detached so it can run independently.
    const proc = spawn(startCommand.cmd, startCommand.args, {
      ...startCommand.options,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref(); // Allows the parent process to exit independently of the child.
    logger.info(`... Start command for ${serviceName} issued.`);
  } catch (startError) {
    logger.error(`... Failed to issue start command for ${serviceName}. This may be okay if another process is already starting it.`, startError);
  }

  // Poll with exponential backoff for the service to become ready.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await axios.get(healthUrl, { timeout: 10000 }); // Increased timeout for health checks
      
      logger.info(`... ${serviceName} service is now ready!`);
      return;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 
                          typeof e === 'object' && e && 'code' in e ? String(e.code) : 
                          'Unknown error';
      logger.warn(`... ${serviceName} is still not responding. (${errorMessage})`);
      
      if (attempt < maxRetries) {
        const delay = initialDelay * 2 ** (attempt - 1);
        logger.info(`... Waiting for ${serviceName}. Checking in ${delay / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  throw new Error(`${serviceName} service failed to become ready after ${maxRetries} attempts.`);
}

/**
 * Pulls a model by executing the 'ollama pull' command directly, which is more robust
 * than using the API for large downloads.
 * @param modelName The name of the model to pull.
 */
async function pullModel(modelName: string): Promise<void> {
  logger.info(`Model "${modelName}" not found. Attempting to download via command line. This may take several minutes...`);
  
  // We execute the command within WSL
  const command = `wsl ollama pull ${modelName}`;
  logger.debug(`Executing command: ${command}`);

  return new Promise<void>((resolve, reject) => {
    const child = exec(command);

    // Log stdout to our info logger
    child.stdout?.on('data', (data) => {
      // Ollama's CLI output includes carriage returns for progress bars, so we clean it up.
      const sanitizedData = data.toString().trim().replace(/(\r\n|\n|\r)/gm, "");
      if (sanitizedData) {
        logger.info(`[Ollama CLI] ${sanitizedData}`);
      }
    });

    // Log stderr to our error logger
    child.stderr?.on('data', (data) => {
      logger.error(`[Ollama CLI] ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      logger.error(`Failed to start model download for "${modelName}".`, error);
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logger.info(`Successfully downloaded model "${modelName}".`);
        resolve();
      } else {
        const errorMessage = `Model download for "${modelName}" failed. The process exited with code ${code}.`;
        logger.error(errorMessage);
        reject(new Error(errorMessage));
      }
    });
  });
}

/**
 * Ensures the Magi Conduit service is running and the required models are available.
 * If a model is not available, it will be pulled from the registry.
 */
async function ensureMagiConduitReady(): Promise<void> {
  const scriptPath = path.resolve(__dirname, '../../../scripts/start_magi_conduit.sh');
  await ensureServiceReady(
    'Magi Conduit',
    MAGI_CONDUIT_API_BASE_URL,
    {
      cmd: 'bash',
      args: [scriptPath],
      options: { 
        shell: true
      },
    },
    10,  // Increase max retries since service startup might take longer
    5000  // Increase initial delay to 5 seconds
  );

  // After service is confirmed running, verify models
  logger.info('Verifying access to LLM models via Magi Conduit...');
  try {
    const response = await axios.get(`${MAGI_CONDUIT_API_BASE_URL}/api/tags`);
    const availableModels = response.data.models.map((m: { name: string }) => m.name);
    
    // Detailed logging to see what models are being reported by the API
    logger.debug('Models reported by Magi Conduit API:', response.data.models.map((m: {name: string}) => m.name));
    logger.debug('Models after parsing (tags removed):', availableModels);

    for (const model of REQUIRED_MODELS) {
      if (!availableModels.includes(model)) {
        // If model is not found, pull it.
        await pullModel(model);
      } else {
        logger.info(`... Model found: ${model}`);
      }
    }
    logger.info('... All required models are available.');
  } catch (error) {
    throw new Error(`Failed to verify access to models via Magi Conduit: ${error}`);
  }
}

/**
 * Generic function to ensure a Python service is running
 */
async function ensurePythonServiceReady(
  serviceName: string,
  serviceDir: string,
  healthUrl: string,
  scriptName: string,
  maxRetries: number = 5,
  initialDelay: number = 2000
): Promise<void> {
  const serviceFullDir = path.resolve(__dirname, serviceDir);
  
  // Use the virtual environment python if available, fallback to system python
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows 
    ? path.join(serviceFullDir, 'venv', 'Scripts', 'python.exe')
    : path.join(serviceFullDir, 'venv', 'bin', 'python');
    
  // Check if virtual environment exists, otherwise use system python
  let pythonCmd = 'python3';
  try {
    await fs.access(venvPython, fs.constants.F_OK);
    pythonCmd = venvPython;
  } catch (error) {
    logger.warn(`${serviceName} virtual environment not found, using system python. Run install-magi.sh to set up properly.`);
  }
  
  await ensureServiceReady(
    serviceName,
    healthUrl,
    {
      cmd: pythonCmd,
      args: [scriptName],
      options: { 
        cwd: serviceFullDir,
        shell: true
      },
    },
    maxRetries,
    initialDelay
  );
}

/**
 * Ensures the Text-to-Speech (TTS) service is running.
 */
async function ensureTTSReady(): Promise<void> {
  await ensurePythonServiceReady(
    'TTS',
    '../../tts',
    `${TTS_API_BASE_URL}/health`,
    'tts_server.py'
  );
}

async function checkPersonaFiles(): Promise<void> {
  logger.info('Verifying access to persona files...');
  for (const persona of Object.values(PERSONAS_CONFIG)) {
    try {
      // Use fs.promises.access to check file readability
      await fs.access(persona.personalitySource, fs.constants.R_OK);
      logger.info(`... Persona file accessible: ${path.basename(persona.personalitySource)}`);
    } catch (error) {
      const errorMessage = `Cannot access persona file: ${persona.personalitySource}`;
      throw new Error(errorMessage);
    }
  }
}

async function verifyInternetAccess(): Promise<void> {
  logger.info('Verifying internet access...');
  try {
    await axios.get('http://www.gstatic.com/generate_204');
    logger.info('... Internet access verified.');
  } catch (error) {
    throw new Error('Internet access verification failed.');
  }
}

async function verifySufficientRam(): Promise<void> {
  logger.info('Verifying sufficient system RAM...');
  const totalRamGB = os.totalmem() / (1024 ** 3);
  const MIN_RAM_GB = 15; // Minimum recommended RAM in GB should be 16
  if (totalRamGB < MIN_RAM_GB) {
    throw new Error(`System RAM (${totalRamGB.toFixed(2)} GB) is below the recommended minimum of ${MIN_RAM_GB} GB.`);
  }
  logger.info(`... System RAM is sufficient (${totalRamGB.toFixed(2)} GB).`);
}

/**
 * Verifies MCP server connections and tool availability
 */
async function verifyMcpServers(): Promise<void> {
  logger.info('Verifying MCP server connections...');
  
  try {
    // Initialize MCP client manager
    await mcpClientManager.initialize();
    logger.info('... MCP client manager initialized successfully');
    
    // Verify each Magi's MCP server and tools
    const magiToCheck = [MagiName.Balthazar, MagiName.Caspar, MagiName.Melchior];
    
    for (const magiName of magiToCheck) {
      try {
        const tools = await mcpClientManager.getMCPToolInfoForMagi(magiName);
        
        if (tools.length > 0) {
          logger.info(`... ${magiName}: Found ${tools.length} available tool(s)`);
          
          // Log available tools for debugging
          for (const tool of tools) {
            logger.debug(`  - ${tool.name}: ${tool.description || 'No description'}`);
          }
          
          // Test search tool for Balthazar (without using API key)
          if (magiName === MagiName.Balthazar) {
            logger.info(`... ${magiName}: Testing search tool availability...`);
            
            // Check if search tool exists
            const hasSearchTool = tools.some(tool => tool.name === 'tavily-search');
            
            if (hasSearchTool) {
              logger.info(`... ${magiName}: ✅ search tool FOUND`);
              
              // Check API key without making actual calls
              const tavilyApiKey = process.env.TAVILY_API_KEY;
              if (tavilyApiKey && tavilyApiKey.startsWith('tvly-')) {
                logger.info(`... ${magiName}: ✅ Tavily API key is properly configured`);
                logger.info(`... ${magiName}: 🟢 Web search should work correctly!`);
              } else {
                logger.error(`... ${magiName}: ❌ Tavily API key missing or invalid - web search will fail`);
              }
            } else {
              logger.error(`... ${magiName}: ❌ search tool not found`);
              logger.error(`... ${magiName}: Available tools: [${tools.map(t => t.name).join(', ')}]`);
              logger.error(`... ${magiName}: 🔴 This will prevent Balthazar from performing web searches!`);
            }
          }

          // Check for Tavily tools and API key availability
          if (tools.some(tool => tool.name === 'tavily-search' || tool.name === 'tavily-extract' || tool.name === 'tavily-crawl' || tool.name === 'tavily-map')) {
            const tavilyApiKey = process.env.TAVILY_API_KEY;
            if (tavilyApiKey && tavilyApiKey.startsWith('tvly-')) {
              logger.info(`... ${magiName}: Tavily search tools available with valid API key`);
            } else if (tavilyApiKey) {
              logger.warn(`... ${magiName}: Tavily tools available but API key format appears invalid (should start with 'tvly-')`);
            } else {
              logger.warn(`... ${magiName}: Tavily tools available but TAVILY_API_KEY not set in environment`);
            }
          } else if (magiName === MagiName.Balthazar) {
            logger.error(`... ${magiName}: NO Tavily tools found! Expected: tavily-search, tavily-extract, tavily-crawl, tavily-map`);
            logger.error(`... ${magiName}: Available tools: [${tools.map(t => t.name).join(', ')}]`);
          }

          // Test personal-data tool for Melchior
          if (magiName === MagiName.Melchior) {
            logger.info(`... ${magiName}: Testing personal-data tool availability...`);
            
            // Check if personal-data tool exists
            const hasPersonalDataTool = tools.some(tool => tool.name === 'personal-data');
            
            if (hasPersonalDataTool) {
              logger.info(`... ${magiName}: ✅ personal-data tool FOUND`);
              
              try {
                // Test write operation
                const testWriteResult = await mcpClientManager.executeTool(
                  MagiName.Melchior,
                  'personal-data',
                  {
                    action: 'store',
                    content: 'System diagnostic test data',
                    category: 'diagnostics'
                  }
                );
                
                if (testWriteResult.isError) {
                  logger.error(`... ${magiName}: ❌ personal-data write test failed: ${JSON.stringify(testWriteResult.data)}`);
                } else {
                  logger.info(`... ${magiName}: ✅ personal-data write test PASSED`);
                  
                  // Test read operation
                  const testReadResult = await mcpClientManager.executeTool(
                    MagiName.Melchior,
                    'personal-data',
                    {
                      action: 'retrieve',
                      categories: ['diagnostics']
                    }
                  );
                  
                  if (testReadResult.isError) {
                    logger.error(`... ${magiName}: ❌ personal-data read test failed: ${JSON.stringify(testReadResult.data)}`);
                  } else {
                    logger.info(`... ${magiName}: ✅ personal-data read test PASSED`);
                    logger.info(`... ${magiName}: 🟢 Personal data storage should work correctly!`);
                  }
                }
              } catch (error) {
                logger.error(`... ${magiName}: ❌ personal-data tool test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            } else {
              logger.error(`... ${magiName}: ❌ personal-data tool not found`);
              logger.error(`... ${magiName}: Available tools: [${tools.map(t => t.name).join(', ')}]`);
              logger.error(`... ${magiName}: 🔴 This will prevent Melchior from accessing personal data!`);
            }
          }
        } else {
          if (magiName === MagiName.Caspar) {
            logger.info(`... ${magiName}: No MCP tools configured (this is expected for Caspar)`);
          } else {
            logger.info(`... ${magiName}: No MCP tools configured`);
          }
        }
      } catch (error) {
        logger.error(`... ${magiName}: MCP server verification failed:`, error);
        // Bright yellow warning for missing MCP services
        if (magiName === MagiName.Balthazar) {
          logger.warn('');
          logger.warn('⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
          logger.warn(`⚠️  WARNING: ${magiName} MCP TOOLS NOT AVAILABLE!`);
          logger.warn('⚠️  Balthazar will not have access to search capabilities');
          logger.warn('⚠️  This may significantly impact system functionality');
          logger.warn('⚠️  Check MCP server configuration and dependencies');
          logger.warn('⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
          logger.warn('');
        } else {
          logger.warn(`... ${magiName}: MCP server not required, continuing...`);
        }
      }
    }
    
    logger.info('... MCP server verification completed');
  } catch (error) {
    logger.error('MCP server verification failed:', error);
    throw new Error(`MCP server verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Runs all system diagnostics to ensure the application can start successfully.
 */
export async function runDiagnostics(): Promise<void> {
  logger.info('--- Running System Diagnostics ---');
  try {
    await verifyInternetAccess();
    await verifySufficientRam();
    await checkPersonaFiles();
    await ensureMagiConduitReady();
    await ensureTTSReady();
    await verifyMcpServers();
    logger.info('--- System Diagnostics Complete ---');
  } catch (error) {
    logger.error('System diagnostics failed.', error);
    throw error;
  }
} 