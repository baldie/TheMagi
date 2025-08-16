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
    userMessage: string;
    strategicGoal: string;
    workingMemory: string;
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { strategicGoal, workingMemory, completedSubGoals, conduitClient, magiName, userMessage } = input;

  if (workingMemory.trim() === '') {
    return userMessage;
  }
  
  const systemPrompt = `You are a data extraction robot. Your only function is consider the USER MESSAGE and to extract data from the GIVEN TEXT that is relevant to the NEXT STRATEGIC GOAL. You do not analyze, interpret, or suggest actions.`;
  
  const userPrompt = `USER MESSAGE:\n"${userMessage}"\n

GIVEN TEXT:
${workingMemory.trim() ? workingMemory.trim() : 'None'}\n
NEXT STRATEGIC GOAL (not for you):\n${strategicGoal}\n
COMPLETED SUB-GOALS:\n${completedSubGoals.join(', ') || 'None'}

INSTRUCTIONS:
Based on the NEXT STRATEGIC GOAL, what data from the GIVEN TEXT will be useful.
Provide ONLY the direct information needed to perform that next action.

OUTPUT:
Based on your instructions, provide any information that could be useful for the next step.
- If the next step is to process an item from a list, your response should be to first select the right item from the list.
- Do not interpret or summarize any of the content. Only respond with the information.`;

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
export const determineNextTacticalGoal = fromPromise(async ({ input }: { 
  input: { 
    strategicGoal: string; 
    context: string; 
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
    userMessage: string;
  } 
}) => {
  const { strategicGoal, context, completedSubGoals, conduitClient, magiName, userMessage } = input;
  const noContextYet = context === userMessage;
  logger.debug(`${magiName} determining next tactical goal for:\n${strategicGoal}`);

  const systemPrompt = `You are a pragmatic planning director. You identify the single next actionable step that someone else needs to undertake in order to achieve their strategic goal. You are forbidden from interpreting, analyzing, or adding any strategic value to the content.`;

  const userPrompt = `Strategic Goal:\n${strategicGoal}\n
Context:\n${context.trim()}\n
${completedSubGoals.length > 0 ? `Completed Tasks:\n${completedSubGoals.join(', ') || 'None'}\n` : ''}
${noContextYet ? '\n' : 'Crucial Instruction: The Context is all the data that has been gathered so far. Do not re-gather any data mentioned in the context.\n'}
INSTRUCTIONS:
What should they do to accomplish their Strategic Goal? This could be:
* Simply executing their Strategic Goal if it's simple an actionable already
* Identifying the first sub-step if their Strategic Goal requires breakdown
* The next logical step if progress has been made but the goal isn't complete
* Frame the output as one of these actions: "analyze", "search", "read", "ask", or "respond"
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
export const selectTool = fromPromise(async ({ input }: { 
  input: { 
    subGoal: string; 
    availableTools: any[];
    conduitClient: ConduitClient;
    context: string;
    magiName: MagiName;
  } 
}) => {
  const { subGoal, availableTools, conduitClient, magiName, context } = input;
  
  logger.debug(`${magiName} selecting tool for sub-goal: ${subGoal}`);
  
  const systemPrompt = `You are a tool selector. Choose the most appropriate tool for the job.`;

  const toolList = availableTools.map(tool => `- ${tool.toString()}`).join('\n\n');

  const userPrompt = `The Job:\n${subGoal}\n
Context:\n${context}\n
Available tools:\n${toolList}\n
Instructions:
Select the tool that directly performs the action described in The Job.
Use information from the Context as parameters for the tool.
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
export const evaluateSubGoalCompletion = fromPromise(async ({ input }: {
  input: {
    subGoal: string;
    toolOutput: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { subGoal, toolOutput, conduitClient, magiName } = input;
  
  const systemPrompt = `You are an evaluation agent. Determine if the sub-goal has been completed based on the tool output.\nIf the goal is to extract, a summary of the content is sufficient.`;
  
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
  return `USER'S MESSAGE:
  "${userMessage}"

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
    case 'ask-user':
    case 'answer-user':
    case 'summarize-info': {
      // For user-directed questions, use the tool output verbatim
      processedOutput = toolOutput;
      break;
    }
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
export const evaluateStrategicGoalCompletion = fromPromise(async ({ input }: {
  input: {
    strategicGoal: string;
    completedSubGoals: string[];
    processedOutput: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}): Promise<GoalCompletionResult> => {
  const { strategicGoal, completedSubGoals, processedOutput, conduitClient, magiName } = input;
  
  const systemPrompt = `You are a goal evaluator. Determine if the strategic goal has been sufficiently achieved based on the completed sub-goals and latest output.`;
  
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