import { fromPromise } from 'xstate';
import { logger } from '../logger';
import { PERSONAS_CONFIG } from './magi2';
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
    strategicGoal: string;
    workingMemory: string;
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { strategicGoal, workingMemory, completedSubGoals, conduitClient, magiName } = input;
  
  const systemPrompt = `You are a context gatherer. Analyze the strategic goal and provide relevant context for tactical planning.`;
  
  const userPrompt = `Strategic Goal:\n${strategicGoal}\n
Working Memory:\n${workingMemory || 'None'}\n
Completed Sub-goals:\n${completedSubGoals.join(', ') || 'None'}

Examine the working memory and completed sub-goals.
Summarize the most relevant information that will help in planning the next immediate step towards achieving the strategic goal.
Do not invent information or over-complicate things.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.3 });
  } catch (error) {
    logger.error(`${magiName} failed to gather context:`, error);
    return `Strategic Goal: ${strategicGoal}\n\nWorking Memory: ${workingMemory}\n\nCompleted Sub-goals:\n${completedSubGoals.join(', ') || 'None'}`;
  }
});

/**
 * Synthesizes gathered context into a focused prompt context
 */
export const synthesizeContext = fromPromise(async ({ input }: {
  input: {
    strategicGoal: string;
    fullContext: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { strategicGoal, fullContext, conduitClient, magiName } = input;
  
  const systemPrompt = `You are a context synthesizer. Create a focused, actionable context summary for tactical planning.`;
  
  const userPrompt = `Strategic Goal:\n${strategicGoal}\n
Full Context:\n${fullContext}

Synthesize this into a clear, focused context that emphasizes the most relevant information for achieving the strategic goal. Keep it concise but comprehensive.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.2 });
  } catch (error) {
    logger.error(`${magiName} failed to synthesize context:`, error);
    return `Goal: ${strategicGoal}\nRelevant Context: ${fullContext}`;
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
  
  const systemPrompt = `You are a tactical planner. Given a strategic goal and current context, determine the next specific, actionable sub-goal.`;

  const userPrompt = `Strategic Goal:\n${strategicGoal}\n
Context:\n${context}
Completed Sub-goals:\n${completedSubGoals.join(', ') || 'None'}

What is the immediate actionable sub-goal that moves you 1 step towards the strategic goal?
Respond with just the single sub-goal text.`;

  try {
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
    magiName: MagiName;
  } 
}) => {
  const { subGoal, availableTools, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} selecting tool for sub-goal: ${subGoal}`);
  
  const systemPrompt = `You are a tool selector. Choose the most appropriate tool for the job.`;

  const toolList = availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

  const userPrompt = `Job:\n${subGoal}

Available tools:
${toolList}

Select the most appropriate tool and respond only with JSON:
{
  "tool": {
    "name": "tool_name",
    "parameters": {}
  }
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.2 });
    return response.tool;
  } catch (error) {
    logger.error(`${magiName} failed to select tool:`, error);
    // Fallback to first available tool
    return {
      name: availableTools[0]?.name ?? 'answer-user',
      parameters: {}
    };
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
  
  const systemPrompt = `You are an evaluation agent. Determine if the sub-goal has been completed based on the tool output.`;
  
  const userPrompt = `Sub-goal:\n${subGoal}

Tool Output:\n${toolOutput}

Has the sub-goal been completed? Respond only with JSON:
{
  "completed": true/false,
  "reason": "explanation"
}`;

  try {
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
  return `
  INSTRUCTIONS
  - Identify and Isolate: Read the entire text to identify the main body of the content (e.g., the article, the blog post, the initial forum post).
  - Extract Verbatim: Pull out the main content's text exactly as it is, preserving all original sentences, paragraphs, and their order. Do not summarize or add any text.

  EXCLUSION CRITERIA
  You MUST remove all of the following non-essential elements:
  - Promotional Content: Advertisements, sponsored links, affiliate marketing, and calls-to-action (e.g., "Sign up," "Download our guide").
  - Website Navigation: Headers, footers, sidebars, menus, and breadcrumbs.
  - Related Links: Lists or grids of "Related Articles," "Recent Posts," "Popular Stories," or "You might also like."
  - Metadata and Threading: Author bios, user signatures, post dates, comment sections, and any replies or comments that follow the main post.
  - Off-topic Text: Any content that is not directly part of the main content's central topic.
  - Images in base64 encoded strings and markdown tokens

  OUTPUT
  Respond ONLY with the cleaned text

  USER'S TOPIC/QUESTION:
  "${userMessage}"

  Now, perform this task on the following raw text.

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
    case 'read-page': {
        logger.debug(`Proccessing read page results with page length: ${toolOutput.length}`);
        // Web pages can have a lot of noise that throw off the magi, so lets clean it
        const relevantContentPrompt = getRelevantContentFromRawText(userMessage ?? '', toolOutput);
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
  
  const systemPrompt = `You are a goal evaluator and discovery detector. 

1. Determine if the strategic goal has been sufficiently achieved
2. Detect if any discoveries were made that might impact strategic planning

Discoveries include:
- "opportunity": Found better tools, methods, or resources that could improve the approach
- "obstacle": Encountered impediments or constraints that affect feasibility  
- "impossibility": Determined that the current approach cannot succeed

Focus on information that could change how the strategic planner approaches the overall task.`;
  
  const userPrompt = `Strategic Goal: ${strategicGoal}
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}
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
    "context": "relevant context for strategic planning"
  }
}

Only include "discovery" if hasDiscovery is true.`;

  try {
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