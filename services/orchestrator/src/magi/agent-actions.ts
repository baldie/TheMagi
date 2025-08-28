import { fromPromise } from 'xstate';
import { logger } from '../logger';
import { PERSONAS_CONFIG } from './magi2';
import type { ConduitClient } from './conduit-client';
import type { MagiName } from '../types/magi-types';
import type { GoalCompletionResult, AgentContext } from './types';
import type { AgenticTool } from './magi2';
import { ToolExecutor } from './tool-executor';
import { TIMEOUT_MS } from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GatherContextInput {
  message: string;
  strategicGoal: string;
  workingMemory: string;
  completedSubGoals: string[];
  conduitClient: ConduitClient;
  magiName: MagiName;
}

interface DetermineNextTacticalGoalInput {
  strategicGoal: string;
  context: string;
  completedSubGoals: string[];
  conduitClient: ConduitClient;
  magiName: MagiName;
  message: string;
}

interface SelectToolInput {
  subGoal: string;
  availableTools: any[];
  conduitClient: ConduitClient;
  context: string;
  message: string;
  magiName: MagiName;
}

interface ExecuteToolInput {
  context: AgentContext;
}

interface ProcessOutputInput {
  tool: AgenticTool | null;
  toolOutput: string;
  currentSubGoal: string;
  message: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
}

interface EvaluateSubGoalInput {
  subGoal: string;
  toolOutput: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
}

interface EvaluateStrategicGoalInput {
  strategicGoal: string;
  completedSubGoals: string[];
  processedOutput: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
}

// ============================================================================
// AGENT ACTIONS - Async operations for the agent state machine
// ============================================================================

const COMMON_ACTIONS = ['read', 'search', 'analyze', 'calculate', 'summarize', 'store', 'access', 'extract', 'respond'];

/**
 * Gathers context for the current strategic goal
 */
export const gatherContext = fromPromise<string, GatherContextInput>(async ({ input }) => {
  const { strategicGoal, workingMemory, completedSubGoals, conduitClient, magiName, message } = input;

  // No context to gather
  const noContextToGather = workingMemory.trim() === '';
  if (noContextToGather) {
    return message;
  }
  
  const systemPrompt = `You are a data extraction robot. Your only function is consider the USER MESSAGE and to extract data from the GIVEN TEXT that is relevant to the NEXT STRATEGIC GOAL. You do not analyze, interpret, or suggest actions.`;
  
  const userPrompt = `USER MESSAGE:\n"${message}"\n

GIVEN TEXT:
${workingMemory.trim() ? workingMemory.trim() : 'None'}\n
NEXT STRATEGIC GOAL (not for you):\n${strategicGoal}
${completedSubGoals.length > 0 ? `\nCOMPLETED SUB-GOALS:\n${completedSubGoals.join(', ') || 'None'}\n` : ''}
INSTRUCTIONS:
Provide ALL the available information needed to ${strategicGoal}
If the next step is to process an item from a list, your response should be to first select the right item from the list.

OUTPUT:
Do not interpret or summarize any of the content. Only respond with the information in complete sentences.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.3 });
  } catch (error) {
    logger.error(`${magiName} failed to gather context:`, error);
    return `Strategic Goal: ${strategicGoal}\n\nWorking Memory: ${workingMemory}\n\nCompleted Sub-goals:\n${completedSubGoals.join(', ') || 'None'}`;
  }
});

/**
 * Determines the next tactical sub-goal based on current context
 */
export const determineNextTacticalGoal = fromPromise<string, DetermineNextTacticalGoalInput>(async ({ input }) => {
  const { strategicGoal, context: workingMemory, completedSubGoals, conduitClient, magiName, message } = input;

  const isStraightForward = (COMMON_ACTIONS.some(action => strategicGoal.trim().toLowerCase().startsWith(action)));
  if (isStraightForward) {
    return strategicGoal;
  }

  const noContextYet = workingMemory === message;
  logger.debug(`${magiName} determining next tactical goal for:\n${strategicGoal}`);

  const systemPrompt = `Your name is ${magiName}. You are a pragmatic planning director. You identify the single next actionable step that someone else needs to undertake in order to achieve their strategic goal. You are forbidden from interpreting, analyzing, or adding any strategic value to the content.`;

  const userPrompt = `Their Strategic Goal:\n${strategicGoal}\n
Context:\n${workingMemory.trim()}\n
${completedSubGoals.length > 0 ? `Completed Tasks:\n${completedSubGoals.join(', ') || 'None'}\n` : ''}
${noContextYet ? '\n' : 'Crucial Instruction: The Context is all the data that has been gathered so far. Do not re-gather any data mentioned in the context.\n'}
INSTRUCTIONS:
What should they do to accomplish their Strategic Goal? This could be:
* Simply executing their Strategic Goal if it's simple an actionable already
* Identifying the first sub-step if their Strategic Goal requires breakdown
* The next logical step if progress has been made but the goal isn't complete
* Start your output with one of these words: ${COMMON_ACTIONS.join(', ')}
Output ONLY the specific action command that should be executed next - No preamble and No examples.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.3 });
  } catch (error) {
    logger.error(`${magiName} failed to produce tactical task:`, error);
    return `Work towards: ${strategicGoal}`;
  }
});

/**
 * Selects the appropriate tool for the current sub-goal
 */
export const selectTool = fromPromise<AgenticTool | null, SelectToolInput>(async ({ input }) => {
  const { subGoal, availableTools, conduitClient, magiName, context: workingMemory, message } = input;
  
  logger.debug(`${magiName} selecting tool for sub-goal: ${subGoal}`);
  
  const systemPrompt = `Persona:\nYour name is ${magiName}. You are a literal tool-use robot. Your only function is to select a tool to perform the 'Action to Perform' and populate its parameters using only the data from the 'Input for Next Action'. You do not analyze, calculate, or modify the input data. Important: If the action starts with "Respond", choose the communication tool.`;

  const toolList = availableTools.map(tool => `- ${tool.toString()}`).join('\n\n');

  const userPrompt = `Action to Perform:\n${subGoal}\n
User Message:\n${message}\n${workingMemory.trim() !== message ? `\nInput for Next Action:\n${workingMemory}\n` : ''}
Available tools:\n${toolList}\n
Instructions:
Pick the tool that will allow you to '${subGoal}.'
Use the data gathered so far as parameters for the tool.
Respond ONLY with the complete JSON.

Format:
{
  "tool": {
    "name": "tool_name",
    "parameters": {
      // tool-specific parameters here
    }
  }
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.2 });
    return response.tool as AgenticTool;
  } catch (error) {
    logger.error(`${magiName} failed to select tool:`, error);
    return null;
  }
});

/**
 * Evaluates if a sub-goal has been completed
 */
export const evaluateSubGoalCompletion = fromPromise<boolean, EvaluateSubGoalInput>(async ({ input }) => {
  const { subGoal, toolOutput, conduitClient, magiName } = input;
  
  const systemPrompt = `PERSONA:\nYou are an outcome-focused evaluation agent. Your job is to determine if a desired state has been achieved.\n
INSTRUCTION:\nEvaluate if the tool task has been completed by focusing on the final state described in the tool output, not the action taken.
A goal is "completed" if the state it aims to achieve is true. For example, if a goal is to "add X" and the tool reports "X already exists," the goal is complete because the final state is that X exists.
If the goal is to extract information, a summary is sufficient for completion. A summary of a web page means the content has been successfully extracted.`

  const userPrompt = `Tool Task:\n${subGoal}\n
Tool Output:\n${toolOutput}\n
Has the tool task been completed? Respond only with JSON:
{
  "completed": true/false,
  "reason": "explanation"
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.1 });
    return response.completed === true;
  } catch (error) {
    logger.error(`${magiName} failed to evaluate tool task completion:`, error);
    // Fallback: consider it complete if we have meaningful output
    return toolOutput.length > 0;
  }
});

/**
 * Helper function to generate prompt for cleaning web page content
 */
function getRelevantContentFromRawText(message: string, rawToolResponse: string): string {
  return `USER'S MESSAGE:
  "${message}"

  INSTRUCTIONS:
  - Identify and Isolate: Read the entire text to identify the main body of the content (e.g., the article, the blog post, the initial forum post).
  - Extract Verbatim: Pull out the main content's text exactly as it is, preserving all original sentences, paragraphs, and their order. Avoid summarizing, synthesizing, or interpreting any text
  - Revelevant - Pay special attention to the user's message and the raw text to ensure that the output is relevant.

  EXCLUSION CRITERIA:
  You MUST remove all of the following non-essential elements:
  - Promotional Content: Advertisements, sponsored links, affiliate marketing, and calls-to-action (e.g., "Sign up," "Download our guide").
  - Website Navigation: Headers, footers, sidebars, menus, licences, and breadcrumbs.
  - Related Links: Lists or grids of "Related Articles," "Recent Posts," "Popular Stories," or "You might also like."
  - Metadata and Threading: Author bios, user signatures, post dates, comment sections, and any replies or comments that follow the main post.
  - Off-topic Text: Any content that is not directly part of the main content's central topic.
  - Images in base64 encoded strings and markdown tokens

  OUTPUT:
  Respond ONLY with the cleaned text

  RAW TEXT:
  ${rawToolResponse}
  `;
}

/**
 * Processes tool output for clarity and relevance
 * Depending on the tool, we might want to process the output differently
 */
export const processOutput = fromPromise<string, ProcessOutputInput>(async ({ input }) => {
  const { tool, toolOutput, currentSubGoal, message, conduitClient, magiName } = input;
  const { model } = PERSONAS_CONFIG[magiName];
  let processedOutput;
  
  // If no tool, return basic processing
  if (!tool) {
    return toolOutput.length > 5000 ? toolOutput.substring(0, 5000) + '... [truncated]' : toolOutput;
  }
  
  // Process output based on tool type
  switch (tool.name) {
    case 'communicate': {
      // For communication, use the tool output verbatim
      processedOutput = toolOutput;
      break;
    }
    case 'read-page': {
        logger.debug(`Proccessing read page results with page length: ${toolOutput.length}`);
        // Web pages can have a lot of noise that throw off the magi, so lets clean it
        const relevantContentPrompt = getRelevantContentFromRawText(message ?? '', toolOutput);
        processedOutput = await conduitClient.contact(
          relevantContentPrompt, 
          "You are an expert text-processing AI. Your sole task is to analyze the provided raw text and extract only the primary content.",
          model,
          { temperature: 0.1 }
        );
        const urls = (tool.parameters as { urls?: string[] })?.urls;
        const url = urls && Array.isArray(urls) && urls.length > 0 ? urls[0] : 'unknown URL';
        processedOutput = `URL: ${url}\n\nPage Summary:\n${processedOutput}`;
      }
      break;
    
    case 'access-data': {
        // Summarize the data we stored or retrieved in human readable form
        logger.debug(`Raw access-data: ${toolOutput}`);
        const summarize = `In an attempt to ${currentSubGoal.toLowerCase()}, you have just ${tool.parameters.action}d data, which resulted in:\n${toolOutput}\n\nNow, concisely summarize the action and result(s) in plain language.  When referring to ${magiName}, speak in the first person and only provide the summary (no preamble).`;
        logger.debug(`Summary prompt:\n${summarize}`);
        processedOutput = await conduitClient.contact(
          summarize,
          "You have access to the user's data.",
          model,
          { temperature: 0.1 }
        );
      }
    break;
    
    case 'search-web':
      // Just use the raw search results without follow-up
      processedOutput = toolOutput;
      break;
    
    default:
      try {
        // General processing for other tools
        const defaultSystemPrompt = `You are an output processor. Clean and organize tool output to be clear and actionable.`;
        const defaultUserPrompt = `Sub-goal:\n${currentSubGoal}\n\nTool Output:\n${toolOutput}\n\nProcess this output to be clear, concise, and directly relevant to the sub-goal. Remove unnecessary details but preserve important information as it relates to the sub-goal.`;

        const { model } = PERSONAS_CONFIG[magiName];
        processedOutput = await conduitClient.contact(defaultUserPrompt, defaultSystemPrompt, model, { temperature: 0.1 });
      } catch (error) {
        logger.error(`${magiName} failed to process output:`, error);
        // Keep original output on error
        processedOutput = toolOutput;
      }
      break;
  }
  
  // Basic length check and truncation
  if (processedOutput.length > 10000) {
    processedOutput = processedOutput.substring(0, 10000) + '... [truncated]';
  }
  
  return processedOutput;
});

/**
 * Executes a tool using the ToolExecutor with proper TTS handling
 */
export const executeTool = fromPromise<string, ExecuteToolInput>(async ({ input }) => {
  let toolOutput = '';
  
  const { toolUser, magiName, selectedTool, conduitClient } = input.context;
  const toolExecutor = new ToolExecutor(toolUser, magiName, TIMEOUT_MS);

  if (!selectedTool) {
    throw new Error('No tool selected');
  }

  const result = await toolExecutor.execute(selectedTool, conduitClient);
  
  if (!result.success) {
    throw new Error(result.error ?? 'Tool execution failed');
  }

  toolOutput = result.output;

  // TTS is now handled by the message queue consumer in message-subscriptions.ts

  return toolOutput;
});

/**
 * Evaluates if the overall strategic goal has been achieved and detects discoveries
 */
export const evaluateStrategicGoalCompletion = fromPromise<GoalCompletionResult, EvaluateStrategicGoalInput>(async ({ input }) => {
  const { strategicGoal, completedSubGoals, processedOutput, conduitClient, magiName } = input;
  
  const systemPrompt = `You are an outcome-focused evaluation agent. Your job is to determine if a desired state of the strategic goal has been achieved. Evaluate if the strategic goal has been completed by focusing on the final state described in the tool output, not the action taken.\n\nThe strategic goal is "achieved" if the state it aims to achieve is true. For example, if a strategic-goal is to "add X" and the tool reports "X already exists," the strategic goal is achieved because the final state is that X exists. Evaluate if the sub-goal has been completed by focusing on the final state described in the tool output, not the action taken. An output indicating that data is a "duplicate" is direct confirmation that the final state is true, and the goal is therefore achieved.`;
  
  const userPrompt = `Strategic Goal: ${strategicGoal}\n
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}\n
Latest Output: ${processedOutput}

Evaluate goal completion. Respond only with JSON:
{
  "achieved": true/false,
  "confidence": 0.0-1.0,
  "reason": "explanation"
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.1 });
    
    const result: GoalCompletionResult = {
      achieved: response.achieved === true,
      confidence: response.confidence || 0.5,
      reason: response.reason || 'No reason provided'
    };


    return result;
  } catch (error) {
    logger.error(`${magiName} failed to evaluate goal completion:`, error);
    // Fallback: consider achieved if we have meaningful output and completed sub-goals
    return {
      achieved: completedSubGoals.length > 0 && processedOutput.length > 0,
      confidence: 0.3,
      reason: 'Fallback evaluation based on completed work'
    };
  }
});