import path from 'path';
import { Model, ModelType } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS, TOOL_REGISTRY } from '../mcp/tools/tool-registry';
import { MagiErrorHandler } from './error-handler';
import { ShortTermMemory } from './short-term-memory';
export { MagiName };

const OBSERVATION_START_DELIMITER = '<<<OBSERVATION_START>>>';
const OBSERVATION_END_DELIMITER = '<<<OBSERVATION_END>>>';

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: ModelType;
  personalitySource: string;
  uniqueAgenticInstructions: string;
  uniqueAgenticActionPriorities: string;
  options: {
    temperature: number;
  };
}

export type AgenticTool = { name: string; parameters: Record<string, unknown>};

export interface AgenticResponse {
  thought: string;
  action: {
    tool: AgenticTool;
  }
}

interface AgenticLoopState {
  synthesis: string;
  goal: string;
  history: string;
  warnings: string[];
  originalUserMessage: string;
  completedSteps: string[];
}

interface StateUpdateResponse {
  synthesis: string;
  goal: string | GoalObject;
}

interface GoalObject {
  description?: string;
  task?: string;
  objective?: string;
  [key: string]: unknown;
}

/**
 * Configuration for each Magi persona.
 */
const MAX_STEPS = 12;

export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant and actionable?
   - Have you learned something that changes what you should focus on?
3. Define your next goal based on logical progression: (Search → Extract → Analyze → Answer)
   - If you found URLs, your next goal should be to extract content from the most relevant URL(s) 3 URLs MAX
   - If you have extracted content from URLs, your next goal should be to analyze that content
   - If the existing research is sufficient to respond to the user's message, your next goal should be to present the analysis.
4. - If current approach isn't working, try a different search strategy
    `,
    uniqueAgenticActionPriorities: `
1. Internal Analysis First: Review the CURRENT GOAL and all provided context (DATA TO PROCESS, WHAT YOU KNOW) to determine if you have sufficient information.
2. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information if needed.
3. Follow Logical Progression:
   - After search results in URLs, extract content from relevant URLs found (3 URLs MAX)
   - After content extraction, analyze and synthesize the DATA TO PROCESS and WHAT YOU KNOW
   - After analysis, provide the final answer
4. Ask User: Only if the query is too vague or you need specifics that your tools cannot provide
5. Answer user: When you have gathered and analyzed sufficient information`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant to the user?
   - Have you learned something that changes what you should focus on?
   - Are you getting stuck in a loop or pursuing an unproductive path?
3. Define your next goal:
   - If current goal is still valid: Continue with the logical next step
   - If current goal is complete: Move to the next phase or provide final answer
   - If current goal is no longer relevant: Pivot to what the user actually needs
   - If the user's message reveals personal preferences, emotional states, personal details, or other information relevant to your role, you should save this information using your tool(s). Consider choosing a category that will make it easy to find this data in the future.
   - If the user asks a question about their personal information, your plan should first retrieve the data using your tool(s).`,
    uniqueAgenticActionPriorities: `1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal constraints that your tools cannot provide
3. Final Answer: When you have gathered sufficient information using your available resources`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant to the user?
   - Have you learned something that changes what you should focus on?
   - Are you getting stuck in a loop or pursuing an unproductive path?
3. Define your next goal:
   - If current goal is still valid: Continue with the logical next step
   - If current goal is complete: Move to the next phase or provide final answer
   - If current goal is no longer relevant: Pivot to what the user actually needs`,
    uniqueAgenticActionPriorities:  `1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal constraints that your tools cannot provide
3. Final Answer: When you have gathered sufficient information using your available resources`,
    options: { temperature: 0.5 },
  },
};

/**
 * The Magi class represents a single AI persona within the Magi system.
 * It uses composition to communicate through a ConduitClient.
 */
export class Magi {
  private personalityPrompt: string = '';
  private status: 'available' | 'busy' | 'offline' = 'offline';
  private toolUser: ToolUser;
  private toolsList: string = '';
  private conduit: ConduitClient;
  private shortTermMemory: ShortTermMemory;
  
  constructor(public name: MagiName, private config: MagiConfig) {
    this.conduit = new ConduitClient(name);
    this.toolUser = new ToolUser(this);
    this.shortTermMemory = new ShortTermMemory(this);
  }

  /**
   * Initialize the Magi
   */
  async initialize(prompt: string): Promise<void> {
    this.personalityPrompt = prompt;
    
    const tools = await this.toolUser.getAvailableTools();
    this.toolsList = tools.map(t => {
      const toolDefinition = TOOL_REGISTRY[t.name];
      if (!toolDefinition) return '';

      const instructions = toolDefinition.instructions || '';
      const parameters = instructions.split('\n')
        .filter(line => line.trim())
        .reduce((acc, line) => {
          const trimmedLine = line.trim();
          const firstColonIndex = trimmedLine.indexOf(':');

          if (firstColonIndex > 0) {
            const key = trimmedLine.substring(0, firstColonIndex).trim();
            const value = trimmedLine.substring(firstColonIndex + 1).trim();
            
            const parenIndex = key.indexOf(' (');
            if (parenIndex > 0) {
                const name = key.substring(0, parenIndex);
                const details = key.substring(parenIndex);
                acc[name] = `${details} ${value}`.trim();
            } else {
                acc[key] = value;
            }
          }
          return acc;
        }, {} as Record<string, string>);

      const paramString = Object.entries(parameters)
        .filter(([name]) => !EXCLUDED_TOOL_PARAMS.has(name))
        .map(([name, type]) => `"${name}":"${type.replace(/"/g, '\\"')}"`)
        .join(',');
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }\n  USAGE:\n ${toolDefinition.instructions || 'Infer instructions based on parameter names'}`;
    }).join('\n\n');
  }

  /**
   * Retrieves the cached personality prompt.
   * @throws If the prompt has not been loaded yet.
   */
  withPersonality(systemInstructionsPrompt: string): string {
    if (!this.personalityPrompt) {
      const err = new Error(`Attempted to access personality for ${this.name}, but it has not been cached.`);
      logger.error('Prompt retrieval error', err);
      throw err;
    }
    return `${this.personalityPrompt}\n\n${systemInstructionsPrompt}`;
  }

  public getStatus(): 'available' | 'busy' | 'offline' {
    return this.status;
  }

  /**
   * Contacts the Magi persona through the Magi Conduit to get a response.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @returns The AI's response text.
   */
  async contact(userPrompt: string): Promise<string> {
    const workingMemory = await this.shortTermMemory.summarize();
    const promptWithContext = workingMemory + '\n' + userPrompt;
    const response = await this.executeWithStatusManagement(() => 
      this.conduit.contact(promptWithContext, this.withPersonality(''), this.config.model, this.config.options)
    );
    
    // Store the interaction in short-term memory
    try {
      this.shortTermMemory.remember('user', 'User prompt', userPrompt);
      this.shortTermMemory.remember(this.name, 'Response', response);
    } catch (memoryError) {
      logger.warn(`Failed to store memory for ${this.name}: ${memoryError}`);
      // Continue execution - memory failure shouldn't break the response
    }
    
    return response;
  }

  async contactSimple(userPrompt: string, systemPrompt?: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      this.conduit.contact(userPrompt, systemPrompt || '', this.config.model, this.config.options)
    );
  }

  public forget(): void {
    this.shortTermMemory.forget();
  }

  /**
   * Safely extracts a goal string from the response object
   */
  private extractGoalString(goal: string | GoalObject): string {
    if (typeof goal === 'string') {
      return goal;
    }
    
    if (typeof goal === 'object' && goal !== null) {
      const goalObj = goal as GoalObject;
      return goalObj.description || goalObj.task || goalObj.objective || JSON.stringify(goal);
    }
    
    return "Continue with current objective";
  }

  /**
   * Builds an analysis prompt for the analyze-data tool
   */
  private buildAnalysisPrompt(focus: string, criteria: string, userMessage: string, { synthesis, history }: AgenticLoopState): string {
    return `TASK: Analyze the available information with focus on: ${focus}
${criteria ? `CRITERIA: ${criteria}` : ''}

CURRENT SYNTHESIS:
${synthesis}

DETAILED INFORMATION FROM RESEARCH:
${history || 'No detailed research data available yet.'}

USER'S ORIGINAL QUESTION: ${userMessage}

Provide a structured analysis addressing the user's needs. Be thorough but concise. Focus on drawing actionable conclusions from the information you already have.
    `.trim();
  }

  /**
   * Extracts the most recent observation from the loop history
   */
  private async extractLatestObservation(history: string): Promise<string> {
    if (!history.trim()) {
      return "No previous actions taken yet.";
    }

    const lastObservationStartIndex = history.lastIndexOf(OBSERVATION_START_DELIMITER);
    if (lastObservationStartIndex === -1) {
      return "Previous actions taken but no observation found.";
    }

    const lastObservationEndIndex = history.lastIndexOf(OBSERVATION_END_DELIMITER);
    if (lastObservationEndIndex === -1 || lastObservationEndIndex < lastObservationStartIndex) {
        // This case should not happen if delimiters are used correctly
        return "Could not find end of last observation.";
    }
    
    const observationStart = lastObservationStartIndex + OBSERVATION_START_DELIMITER.length;
    let observation = history.substring(observationStart, lastObservationEndIndex);
    
    // Add length limits and summarization
    const MAX_OBSERVATION_LENGTH = 10000;
    if (observation.length > MAX_OBSERVATION_LENGTH) {
      logger.warn(`${this.name} observation is too long (${observation.length} chars), summarizing...`);
      const summaryPrompt = `Summarize the following text in a few sentences and only respond with the summary:\n\n${observation}`;
      const summary = await this.contactSimple(summaryPrompt, 'You are a summarization assistant.');
      return `[Summarized]: ${summary}`;
    }

    return observation;
  }

  /**
   * Synthesizes current state and updates goals based on latest observation
   */
  private async synthesizeState(
    loopState: AgenticLoopState, 
    userMessage: string, 
    actionHistory: string[]
  ): Promise<void> {
    const { history, originalUserMessage, synthesis, goal, completedSteps } = loopState;
    const observation = await this.extractLatestObservation(history);
    
    const systemInstructionsPrompt = `
Your job is to synthesize information and define the next goal for yourself. Focus on responding to the user's original message: "${loopState.originalUserMessage}"

INSTRUCTIONS:
${this.config.uniqueAgenticInstructions}

FOCUS CHECK: Before setting your next goal, ask yourself:
- Does this goal help answer "${originalUserMessage}"?
- Am I going down a rabbit hole that doesn't serve the user?
- Do I have enough information to provide a useful answer?

COMPLETED STEPS: ${completedSteps.join(', ') || 'None yet'}
AVOID REPETITION: Don't repeat actions you've already completed.

TASK:
Review all information to update the "synthesis" of what you know.
Define the single next "goal" based on your evaluation.
Format response as a single JSON object with no other text.

EXAMPLE FORMAT:
\`\`\`json
{
  "synthesis": "Updated summary of what you now know...",
  "goal": "The single next goal to pursue..."
}
\`\`\`
`.trim();

    const synthesisPrompt = `
CONTEXT:
What you know so far:
${synthesis}

Your previous goal was:
${goal}

YOUR LATEST FINDINGS:
${observation}

ACTIONS TAKEN SO FAR:
${actionHistory.join(' → ') || 'None yet'}

Latest User Message: "${userMessage}"
`.trim();

    try {
      const stateUpdate: StateUpdateResponse = await this.executeWithStatusManagement(() => 
        this.conduit.contactForJSON(synthesisPrompt, this.withPersonality(systemInstructionsPrompt), this.config.model, this.config.options)
      );
      
      loopState.synthesis = stateUpdate.synthesis;
      loopState.goal = this.extractGoalString(stateUpdate.goal);
      
      logger.debug(`${this.name} state update - synthesis: ${stateUpdate.synthesis}, goal: ${loopState.goal}`);
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for state synthesis:`, jsonError);
      // Continue with previous state rather than breaking the loop
      logger.warn(`${this.name} continuing with previous goal: ${loopState.goal}`);
    }
  }

  /**
   * Checks if an action is repetitive based on recent history
   */
  private isRepetitiveAction(actionHistory: string[], toolName: string): boolean {
    const recentActions = actionHistory.slice(-2); // Last 2 actions (will be 3 total with current)
    return recentActions.length === 2 && recentActions.every(action => action === toolName);
  }

  /**
   * Adds warning to synthesis if repetitive action is detected
   */
  private addRepetitiveActionWarning(loopState: AgenticLoopState, toolName: string): void {
    logger.warn(`${this.name} detected repetitive use of ${toolName} - forcing progression`);
    loopState.warnings.push(`You have used the '${toolName}' tool three times in a row. You MUST use a different tool or provide a final answer now. Use any tool that is not '${toolName}'.`);
  }

  /**
   * Decides next action and executes it, returning result and whether to continue loop
   */
  private async decideNextAction(
    loopState: AgenticLoopState,
    userMessage: string,
    workingMemory: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    const observation = await this.extractLatestObservation(loopState.history);
    const toolsWithClarification = this.toolsList + `
- { "tool": { "name": "ask-user", "description": "Ask the user a clarifying question if more information is needed.", "parameters": {"question":"string (required) - The question to ask the user."} } }
- { "tool": { "name": "analyze-data", "description": "Process and analyze available information to draw conclusions and insights", "parameters": {"focus":"string (required) - What aspect to analyze (e.g., 'cost comparison', 'safety ranking', 'best options')","criteria":"string (optional) - Any specific constraints or requirements"} } }\n  USAGE:\n  focus (required): What aspect to analyze - cost comparison, safety ranking, best options, trend analysis\n  criteria (optional): Specific constraints or requirements to apply
- { "tool": { "name": "answer-user", "description": "Answer the user with the results you have synthesized, or directly if it is a simple inquiry.", "parameters": { "answer": "string (required) - The final answer to provide to the user. This should be in conversatonal tone."} } }`;

    const warnings = loopState.warnings.join('\n');
    if (warnings) {
        loopState.warnings = []; // Clear warnings after use
    }

    const systemPrompt = `
Your immediate task is to decide the single next step to achieve your current goal. Think step by step.

${warnings ? `IMPORTANT WARNINGS:\n${warnings}\n` : ''}AVAILABLE TOOLS:
${toolsWithClarification}

DATA TO PROCESS:
${observation}

ACTION PRIORITIES:${this.config.uniqueAgenticActionPriorities}

Format your response as JSON only:

Example for a tool call:
\`\`\`json
{
  "thought": "I will use a tool to get information.",
  "action": { "tool": { "name": "<TOOL_NAME>", "parameters": { "<TOOL_PARAMETER_NAME>": "<TOOL_PARAMETER_VALUE>" } } }
}
\`\`\`

Example for asking the user a question:
\`\`\`json
{
  "thought": "I cannot proceed without knowing the user's budget.",
  "action": { "tool": { "name": "ask-user", "parameters": { "question": "<QUESTION_TO_ASK>" } } }
}
\`\`\`

Example for a final answer:
\`\`\`json
{
  "thought": "I have all the information needed.",
  "action": { "tool": { "name": "answer-user", "parameters": { "answer": "<FINAL_ANSWER_TEXT>" } } }
}
\`\`\`
`.trim();

    const reasonPrompt = `
${workingMemory ? `CONTEXT:\n${workingMemory}` : ''}

WHAT YOU KNOW:
${loopState.synthesis}

ORIGINAL USER MESSAGE: "${loopState.originalUserMessage}"
FOCUS: Ensure your goal moves you closer to a response to this message.

ACTIONS TAKEN: ${actionHistory.join(' → ') || 'None yet'}
COMPLETED STEPS: ${loopState.completedSteps.join(', ') || 'None yet'}

CURRENT GOAL:
${loopState.goal}
`.trim();

    let agenticResponse: AgenticResponse;
    try {
      agenticResponse = await this.executeWithStatusManagement(() => 
        this.conduit.contactForJSON(reasonPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
      );
      logger.debug(`${this.name} agentic response - thought: ${agenticResponse.thought}, action: ${JSON.stringify(agenticResponse.action)}`);
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for action decision:`, jsonError);
      return { response: "Sorry, I encountered an error processing my response and had to stop.", shouldBreak: true };
    }
    
    const { tool } = agenticResponse.action;

    if (tool) {
      return await this.handleToolResponse(tool, agenticResponse, userMessage, loopState, actionHistory);
    } else {
      logger.error(`Invalid response from agentic loop, no tool supplied:\n${JSON.stringify(agenticResponse)}`);
      return { response: "Sorry, I received an invalid response and had to stop.", shouldBreak: true };
    }
  }

  public async contactAsAgent(userMessage: string): Promise<string> {
    let response = '';
    try {
      logger.info(`${this.name} beginning agentic loop...`);

      const workingMemory = await this.shortTermMemory.summarize();
      const loopState: AgenticLoopState = {
        synthesis: "Nothing is known yet.",
        goal: "Formulate a plan to address the user's message.",
        history: "",
        warnings: [],
        originalUserMessage: userMessage,
        completedSteps: []
      };
      const actionHistory: string[] = [];

      for (let step = 1; step < MAX_STEPS; step++) {
        // PHASE 1: SYNTHESIZE STATE
        if (step > 1) {
          await this.synthesizeState(loopState, userMessage, actionHistory);
        }

        // PHASE 2: DECIDE ACTION
        const actionResult = await this.decideNextAction(loopState, userMessage, workingMemory, actionHistory);
        if (actionResult.shouldBreak) {
          response = actionResult.response || '';
          break;
        }
      }
      
      // Handle loop completion without final answer
      if (!response) {
        logger.warn(`${this.name} agentic loop completed ${MAX_STEPS - 1} steps without reaching final answer`);
        response = `Sorry, I seem to have gotten stuck in a loop. Here is what I found:\n${loopState.synthesis}`;
      }

      // Store the interaction in short-term memory
      if (response) {
        try {
          this.shortTermMemory.remember('user', 'User message', userMessage);
          this.shortTermMemory.remember(this.name, loopState.synthesis, response);
        } catch (memoryError) {
          logger.warn(`Failed to store agentic memory for ${this.name}: ${memoryError}`);
        }
      }
    } catch (error) {
      logger.error(`ERROR: ${error}`);
      throw MagiErrorHandler.createContextualError(error, {
        magiName: this.name,
        operation: 'agentic loop'
      });
    }

    const finalResponse = await this.makeTTSReady(response);
    logger.debug(`\n🤖🤖🤖 Final response:\n${finalResponse}\n🤖🤖🤖\n`);
    return finalResponse;
  }

  
  private async makeTTSReady(text: string): Promise<string> {
    const systemPrompt = `PERSONA
You are also a skilled Vocal Synthesizer able to take a text passage, and rewrite it into a clear, natural, and human-like script. The text must be ready for a Text-to-Speech (TTS) engine. Your goal is to ensure the final output sounds like a person speaking, not a computer reading a document.`;

    const userPrompt = `
INSTRUCTIONS
Review the 'TEXT PASSAGE' provided below. Rewrite it completely into a 'SPOKEN SCRIPT' that is easy for a user to understand when heard. The meaning and core data must be preserved, but the language should be adapted for audio delivery.

RULES

EXPAND ALL ABBREVIATIONS: Never use abbreviations. 'e.g.' must become 'for example'. 'i.e.' must become 'that is'.

VERBALIZE SYMBOLS AND NUMBERS: Write out all symbols and numbers as spoken words. '$515k' becomes 'five hundred and fifteen thousand dollars'. '52%' becomes 'fifty-two percent'.

CLARIFY TECHNICAL JARGON AND URLS: Rephrase technical terms into simpler language. 'Redfin.com' should be written as 'Redfin dot com'.

ENSURE CONVERSATIONAL FLOW: The script must flow like natural conversation. Use connecting phrases and break up long, complex sentences.

PRESERVE KEY INFORMATION: Do not lose or alter the critical data points. The core facts must remain intact.

EXAMPLES

EXAMPLE 1:
TEXT PASSAGE: User's query re: job relocation. Balthazar: logic dictates yes, citing lower COL & job proximity. Melchior: no, citing user's prev. social integration issues. Caspar: impasse. See UI for details. Data: new home ~1.5mi from office, rent ~$2,100/mo vs. current $2,800/mo.
SPOKEN SCRIPT: Regarding your question about relocating for the new job, we have reached an impasse and your input is needed. Balthazar advises that the move is logical, highlighting a lower cost of living and the new home's convenient location, which is only about one point five miles from the office. He also notes the rent would be around twenty-one hundred dollars a month compared to your current twenty-eight hundred. However, Melchior has raised a significant concern, advising against the move. She references the difficulties you had finding friends and social support the last time you moved. Because of these strong opposing views, we recommend you review the full deliberation in the app to make the final decision.

EXAMPLE 2:
TEXT PASSAGE: Re: West Coast cities. Analysis: Eugene, OR is a strong contender. Data: median home price ~$350k, vs. West Coast avg. of $612,233. Other options e.g., Salem, OR, have higher crime (2.5 per capita) and unemployment (~4%). Stockton, CA is cheaper ($425k) but needs more analysis.
SPOKEN SCRIPT: I have completed the analysis on the best cities to live in on the west coast based on a lower cost of living. The city of Eugene, Oregon appears to be a strong contender. Its median home price is approximately three hundred and fifty thousand dollars, which is significantly lower than the average of six hundred and twelve thousand, two hundred and thirty-three dollars across California, Oregon, and Washington. While other options exist, for example Salem, Oregon, they currently have higher rates for crime and unemployment. Stockton, California is also more affordable at four hundred and twenty-five thousand dollars, but I will need to conduct further research to give you a complete picture.

YOUR TASK: Now, rewrite this input conclusion into a spoken script.

TEXT PASSAGE:\n${text}

SPOKEN SCRIPT:\n`

    return await this.conduit.contact(userPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
  }
  
  /**
   * Handles tool response execution using a switch statement
   */
  private async handleToolResponse(
    tool: AgenticTool,
    agenticResponse: AgenticResponse,
    userMessage: string,
    loopState: AgenticLoopState,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    switch (tool.name) {
      case 'ask-user': {
        const response = tool.parameters.question as string;
        logger.info(`${this.name} has a clarifying question: "${response}"`);
        return { response, shouldBreak: true };
      }

      case 'analyze-data': {
        const analysisPrompt = this.buildAnalysisPrompt(
          tool.parameters.focus as string,
          tool.parameters.criteria as string || '',
          userMessage,
          loopState
        );
        
        const analysisResult = await this.contactSimple(analysisPrompt);
        const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${OBSERVATION_START_DELIMITER}${analysisResult}${OBSERVATION_END_DELIMITER}\n\n`;
        loopState.history += historyEntry;
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(actionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Add action to history
        actionHistory.push(tool.name);
        return { shouldBreak: false };
      }

      case 'answer-user': {
        return { response: tool.parameters.answer as string, shouldBreak: true };
      }

      default: {
        const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, userMessage);
        const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${OBSERVATION_START_DELIMITER}${toolResponse}${OBSERVATION_END_DELIMITER}\n\n`;
        loopState.history += historyEntry;
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(actionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Add action to history
        actionHistory.push(tool.name);
        
        // Track completed steps to avoid repetition
        const stepDescription = `${tool.name}: ${JSON.stringify(tool.parameters)}`;
        if (!loopState.completedSteps.includes(stepDescription)) {
          loopState.completedSteps.push(stepDescription);
        }
        
        return { shouldBreak: false };
      }
    }
  }

  /**
   * Executes a contact operation with proper status management
   */
  private async executeWithStatusManagement<T>(operation: () => Promise<T>): Promise<T> {
    this.status = 'busy';
    
    try {
      const result = await operation();
      this.status = 'available';
      return result;
    } catch (error) {
      this.status = 'available';
      throw error;
    }
  }
}

// Create and export the three Magi instances
export const balthazar = new Magi(MagiName.Balthazar, PERSONAS_CONFIG.Balthazar);
export const melchior = new Magi(MagiName.Melchior, PERSONAS_CONFIG.Melchior);
export const caspar = new Magi(MagiName.Caspar, PERSONAS_CONFIG.Caspar);

// Export all Magi instances in a single object for easy iteration
export const allMagi = {
  [MagiName.Balthazar]: balthazar,
  [MagiName.Melchior]: melchior,
  [MagiName.Caspar]: caspar,
}; 