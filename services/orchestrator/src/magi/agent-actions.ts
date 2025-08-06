import { fromPromise } from 'xstate';
import { logger } from '../logger';
import type { ConduitClient } from './conduit-client';
import type { MagiName } from '../types/magi-types';
import { PERSONAS_CONFIG } from './magi2';

// ============================================================================
// AGENT ACTIONS - Async operations for the agent state machine
// ============================================================================

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
  
  logger.debug(`${magiName} determining next tactical goal for: ${strategicGoal}`);
  
  const systemPrompt = `You are a tactical planner. Given a strategic goal and current context, determine the next specific, actionable sub-goal.`;

  const userPrompt = `Strategic Goal: ${strategicGoal}
Context: ${context}
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}

What is the next specific, actionable sub-goal to work towards the strategic goal?
Respond with just the sub-goal text.`;

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

  const userPrompt = `Job: ${subGoal}

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
  
  const userPrompt = `Sub-goal: ${subGoal}

Tool Output: ${toolOutput}

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
  
  const userPrompt = `Strategic Goal: ${strategicGoal}
Working Memory: ${workingMemory}
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}

Gather and organize relevant context that will help with tactical planning. Respond with organized context information.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    return await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.3 });
  } catch (error) {
    logger.error(`${magiName} failed to gather context:`, error);
    return `Strategic Goal: ${strategicGoal}\nWorking Memory: ${workingMemory}\nCompleted Sub-goals: ${completedSubGoals.join(', ') || 'None'}`;
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
  
  const userPrompt = `Strategic Goal: ${strategicGoal}
Full Context: ${fullContext}

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
 * Processes tool output for clarity and relevance
 */
export const processOutput = fromPromise(async ({ input }: {
  input: {
    toolOutput: string;
    currentSubGoal: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { toolOutput, currentSubGoal, conduitClient, magiName } = input;
  
  const systemPrompt = `You are an output processor. Clean and organize tool output to be clear and actionable.`;
  
  const userPrompt = `Sub-goal: ${currentSubGoal}
Tool Output: ${toolOutput}

Process this output to be clear, concise, and directly relevant to the sub-goal. Remove unnecessary details but preserve important information.`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const processed = await conduitClient.contact(userPrompt, systemPrompt, model, { temperature: 0.1 });
    
    // Basic length check and truncation
    if (processed.length > 5000) {
      return processed.substring(0, 5000) + '... [truncated]';
    }
    
    return processed;
  } catch (error) {
    logger.error(`${magiName} failed to process output:`, error);
    // Fallback processing
    let output = toolOutput;
    if (output.length > 5000) {
      output = output.substring(0, 5000) + '... [truncated]';
    }
    return output;
  }
});

/**
 * Evaluates if the overall strategic goal has been achieved
 */
export const evaluateGoalCompletion = fromPromise(async ({ input }: {
  input: {
    strategicGoal: string;
    completedSubGoals: string[];
    processedOutput: string;
    conduitClient: ConduitClient;
    magiName: MagiName;
  }
}) => {
  const { strategicGoal, completedSubGoals, processedOutput, conduitClient, magiName } = input;
  
  const systemPrompt = `You are a goal evaluator. Determine if the strategic goal has been sufficiently achieved based on completed work.`;
  
  const userPrompt = `Strategic Goal: ${strategicGoal}
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}
Latest Output: ${processedOutput}

Has the strategic goal been sufficiently achieved? Consider both the completed sub-goals and the quality of work done. Respond only with JSON:
{
  "achieved": true/false,
  "confidence": 0.0-1.0,
  "reason": "explanation"
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.1 });
    return {
      achieved: response.achieved === true,
      confidence: response.confidence || 0.5,
      reason: response.reason || 'No reason provided'
    };
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