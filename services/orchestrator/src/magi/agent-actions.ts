import { fromPromise } from 'xstate';
import { logger } from '../logger';
import { PERSONAS_CONFIG } from './magi2';
import { testHooks } from '../testing/test-hooks';
import type { ConduitClient } from './conduit-client';
import type { MagiName } from '../types/magi-types';
import type { GoalCompletionResult } from './types';
import type { AgenticTool } from './magi2';

// ============================================================================
// AGENT ACTIONS - Async operations for the agent state machine
// ============================================================================

/**
 * Gathers context for the current strategic goal
 */
export const gatherContext = fromPromise(async ({ input }: {
  input: {
    userMessage: string;
    strategicGoal: string;
    workingMemory: string;
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { strategicGoal, workingMemory, completedSubGoals, conduitClient, magiName, userMessage } = input;

  // Test behaviors should be injected by test doubles; keep production clean.
  
  const systemPrompt = `You are a data extraction robot. Your only function is to identify and list key factual data points from a given text. You do not analyze, interpret, or suggest actions.`;
  
  const userPrompt = `User's Message:\n"${userMessage}"\n

Given Text:
${workingMemory.trim() ? workingMemory.trim() : 'None'}\n
Current Strategic Goal (not for you):\n${strategicGoal}\n
Completed Sub-goals:\n${completedSubGoals.join(', ') || 'None'}

INSTRUCTIONS:
First, verify if 'Given Text' has been provided. If it has not, your only action is to report that 'no relevant context available'.
Otherwise, examine the 'Current Strategic Goal' and the available data from previous steps.
Your task is to determine the single, most logical **next action** required to achieve the goal.
Provide ONLY the direct information needed to perform that next action.

OUTPUT:
Based on your instructions, provide the single piece of information needed for the next step.
- If the next step is to process an item from a list, your response should be to first select the right item from the list.
- Do not extract facts or summarize content unless the source has already been chosen.`;

  try {
    if (testHooks.isEnabled()) {
      // Fast path in tests: avoid LLM round-trips
      const parts = [
        `Strategic Goal: ${strategicGoal}`,
        `Working Memory: ${workingMemory}`,
        `Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}`,
      ];
      return parts.join('\n');
    }
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
export const determineNextTacticalGoal = fromPromise(async ({ input }: { 
  input: { 
    strategicGoal: string; 
    context: string; 
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  } 
}) => {
  const { strategicGoal, context, completedSubGoals, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} determining next tactical goal for:\n${strategicGoal}`);

  // Test behaviors should be injected by test doubles; keep production clean.
  
  const systemPrompt = `You are a tactical planner. Given a strategic goal and current context, determine the next specific, actionable sub-goal.`;

  const userPrompt = `Strategic Goal:\n${strategicGoal}\n
Context:\n${context}\n
Completed Sub-goals:\n${completedSubGoals.join(', ') || 'None'}

Crucial Instruction: The Context confirms that all necessary data has been gathered. Your task is to define the single next step to bring that data to the user. Do not re-gather any data mentioned in the context.

What is the immediate actionable sub-goal that moves you 1 step towards the strategic goal?
Respond with just the single sub-goal text.`;

  try {
    if (testHooks.isEnabled()) {
      // Simple deterministic plan for tests
      if (completedSubGoals.length === 0) return 'Search web for answer';
      return 'Respond with the answer';
    }
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.3 });
  } catch (error) {
    logger.error(`${magiName} failed to produce tactical sub-goal:`, error);
    return `Work towards: ${strategicGoal}`;
  }
});

/**
 * Selects the appropriate tool for the current sub-goal
 */
export const selectTool = fromPromise(async ({ input }: { 
  input: { 
    subGoal: string; 
    availableTools: any[];
    conduitClient: ConduitClient;
    context: string;
    magiName: MagiName;
    userMessage?: string;
  } 
}) => {
  const { subGoal, availableTools, conduitClient, magiName, context, userMessage } = input;
  
  logger.debug(`${magiName} selecting tool for sub-goal: ${subGoal}`);

  // Simple heuristic: map obvious sub-goals to tools without LLM round-trip
  const normalized = subGoal.toLowerCase();
  if (normalized.includes('search') && availableTools.some(t => t.name === 'search-web')) {
    return { name: 'search-web', parameters: { query: userMessage ?? '' } };
  }
  if ((normalized.includes('respond') || normalized.includes('answer')) && availableTools.some(t => t.name === 'answer-user')) {
    return { name: 'answer-user', parameters: { answer: 'Answer' } };
  }
  
  const systemPrompt = `You are a tool selector. Choose the most appropriate tool for the job.`;

  const toolList = availableTools.map(tool => `- ${tool.toString()}`).join('\n\n');

  const userPrompt = `The Job:\n${subGoal}\n
Context:\n${context}\n
Available tools:\n${toolList}\n
Instructions:
Select the tool that directly performs the action described in the Job.
Use any information from the Context as parameters for the selected tool.
Respond only with the complete JSON for your choice.

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
    if (testHooks.isEnabled()) {
      const lower = subGoal.toLowerCase();
      if (lower.includes('search')) {
        return { name: 'search-web', parameters: { query: userMessage ?? '' } };
      }
      if (lower.includes('respond') || lower.includes('answer')) {
        return { name: 'answer-user', parameters: { answer: 'Answer' } };
      }
      // Fallback deterministic choice for tests
      return { name: availableTools[0]?.name || 'answer-user', parameters: {} };
    }
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.2 });
    const tool = response.tool as AgenticTool;
    // If LLM selected a non-answer tool but subGoal implies responding, prefer answer-user when available
    if ((/respond|answer/i.test(subGoal)) && tool.name !== 'answer-user' && availableTools.some(t => t.name === 'answer-user')) {
      return { name: 'answer-user', parameters: { answer: 'Answer' } };
    }
    return tool;
  } catch (error) {
    logger.error(`${magiName} failed to select tool:`, error);
    // Fallback to first available tool
    if (availableTools.some(t => t.name === 'search-web')) {
      return { name: 'search-web', parameters: { query: userMessage ?? '' } };
    }
    if (availableTools.some(t => t.name === 'answer-user')) {
      return { name: 'answer-user', parameters: { answer: 'Answer' } };
    }
    return { name: availableTools[0]?.name ?? 'answer-user', parameters: {} };
  }
});

/**
 * Evaluates if a sub-goal has been completed
 */
export const evaluateSubGoalCompletion = fromPromise(async ({ input }: {
  input: {
    subGoal: string;
    toolOutput: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { subGoal, toolOutput, conduitClient, magiName } = input;
  
  // Test behaviors should be injected by test doubles; keep production clean.
  
  const systemPrompt = `You are an evaluation agent. Determine if the sub-goal has been completed based on the tool output.`;
  
  const userPrompt = `Sub-goal:\n${subGoal}

Tool Output:\n${toolOutput}

Has the sub-goal been completed? Respond only with JSON:
{
  "completed": true/false,
  "reason": "explanation"
}`;

  try {
    if (testHooks.isEnabled()) {
      return toolOutput.length > 0;
    }
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.1 });
    return response.completed === true;
  } catch (error) {
    logger.error(`${magiName} failed to evaluate sub-goal completion:`, error);
    // Fallback: consider it complete if we have meaningful output
    return toolOutput.length > 0;
  }
});

/**
 * Helper function to generate prompt for cleaning web page content
 */
function getRelevantContentFromRawText(userMessage: string, rawToolResponse: string): string {
  return `USER'S MESSAGE:
  "${userMessage}"

  INSTRUCTIONS:
  - Identify and Isolate: Read the entire text to identify the main body of the content (e.g., the article, the blog post, the initial forum post).
  - Extract Verbatim: Pull out the main content's text exactly as it is, preserving all original sentences, paragraphs, and their order.Avoid summarizing, synthesizing, or interpreting any text
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
export const processOutput = fromPromise(async ({ input }: {
  input: {
    tool: AgenticTool;
    toolOutput: string;
    currentSubGoal: string;
    userMessage?: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { tool, toolOutput, currentSubGoal, userMessage, conduitClient, magiName } = input;
  const { model } = PERSONAS_CONFIG[magiName];
  let processedOutput;
  
  // Process output based on tool type
  switch (tool.name) {
    case 'ask-user': {
      // For user-directed questions, use the tool output verbatim
      processedOutput = toolOutput;
      break;
    }
    case 'answer-user': {
      // For user-directed answers, use the tool output verbatim
      processedOutput = toolOutput;
      break;
    }
    case 'read-page': {
        logger.debug(`Proccessing read page results with page length: ${toolOutput.length}`);
        // Web pages can have a lot of noise that throw off the magi, so lets clean it
        if (testHooks.isEnabled()) {
          processedOutput = toolOutput;
        } else {
          const relevantContentPrompt = getRelevantContentFromRawText(userMessage ?? '', toolOutput);
          processedOutput = await conduitClient.contact(
            relevantContentPrompt, 
            "You are an expert text-processing AI. Your sole task is to analyze the provided raw text and extract only the primary content.",
            model,
            { temperature: 0.1 }
          );
        }
        const urls = (tool.parameters as { urls?: string[] })?.urls;
        const url = urls && Array.isArray(urls) && urls.length > 0 ? urls[0] : 'unknown URL';
        processedOutput = `URL: ${url}\n\nPage Summary:\n${processedOutput}`;
      }
      break;
    
    case 'personal-data': {
        // Summarize the data we received back in human readable form
        logger.debug(`Raw personal-data retrieved: ${toolOutput}`);
        const summarize = `You have just completed the following task:\n${toolOutput}\n\nNow, concisely summarize the action and result(s) in plain language. When referring to ${magiName}, speak in the first person and only provide the summary.`;
        logger.debug(`Summary prompt:\n${summarize}`);
        processedOutput = await conduitClient.contact(
          summarize,
          "You are a summary assistant.",
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
        if (testHooks.isEnabled()) {
          processedOutput = toolOutput;
          break;
        }
        // General processing for other tools
        const defaultSystemPrompt = `You are an output processor. Clean and organize tool output to be clear and actionable.`;
        const defaultUserPrompt = `Sub-goal:\n${currentSubGoal}\n\nTool Output:\n${toolOutput}\n\nProcess this output to be clear, concise, and directly relevant to the sub-goal. Remove unnecessary details but preserve important information.`;

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
 * Evaluates if the overall strategic goal has been achieved and detects discoveries
 */
export const evaluateGoalCompletion = fromPromise(async ({ input }: {
  input: {
    strategicGoal: string;
    completedSubGoals: string[];
    processedOutput: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}): Promise<GoalCompletionResult> => {
  const { strategicGoal, completedSubGoals, processedOutput, conduitClient, magiName } = input;
  
  // Test behaviors should be injected by test doubles; keep production clean.
  
  const systemPrompt = `You are a goal evaluator and discovery detector. 

1. Determine if the strategic goal has been sufficiently achieved
2. Detect if any discoveries were made that might impact strategic planning

Discoveries include:
- "opportunity": Found better tools, methods, or resources that could improve the approach
- "obstacle": Encountered impediments or constraints that affect feasibility  
- "impossibility": Determined that the current approach cannot succeed

Focus on information that could change how the strategic planner approaches the overall task.`;
  
  const userPrompt = `Strategic Goal: ${strategicGoal}\n
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}\n
Latest Output: ${processedOutput}

Evaluate goal completion and check for strategic discoveries. Respond only with JSON:
{
  "achieved": true/false,
  "confidence": 0.0-1.0,
  "reason": "explanation",
  "hasDiscovery": true/false,
  "discovery": {
    "type": "opportunity|obstacle|impossibility",
    "details": "what was discovered",
  }
}

Only include "discovery" if hasDiscovery is true.`;

  try {
    if (testHooks.isEnabled()) {
      return {
        achieved: processedOutput.length > 0,
        confidence: 0.9,
        reason: 'Test mode fast-path',
      };
    }
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.1 });
    
    const result: GoalCompletionResult = {
      achieved: response.achieved === true,
      confidence: response.confidence || 0.5,
      reason: response.reason || 'No reason provided'
    };

    if (response.hasDiscovery && response.discovery) {
      result.hasDiscovery = true;
      result.discovery = {
        type: response.discovery.type || 'obstacle',
        details: response.discovery.details || 'Discovery details not provided',
        context: response.discovery.context || 'Context not provided'
      };
    }

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