import { logger } from '../logger';
import { MagiName } from './magi';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Model } from '../config';
import { MAGI_MANIFESTO } from './magi_manifesto';

/**
 * Enhanced plan step with tool information
 */
export interface PlanStep {
  description: string;
  requiresTool: boolean;
  toolName?: string;
  toolArguments?: Record<string, any>;
  skipped?: boolean;
}

/**
 * Planner handles plan generation, parsing, and execution for the Magi system.
 */
export class Planner {
  private toolsList: string;
  constructor(
    private magiName: MagiName,
    private conduitClient: ConduitClient,
    private toolUser: ToolUser,
    private model: Model,
    private temperature: number
  ) {
    this.toolsList = this.toolUser.getAvailableTools().map(t => {
      const parameterName = t.inputSchema?.parameterName;
      return `- [TOOL][${t.name}]: ${t.description} [ARGS][${parameterName}]`;
    }).join('\n');
  }

  /**
   * Update the personality prompt - called when the Magi personality is set
   */
  setPersonality(personalityPrompt: string): void {
    this.personalityPrompt = personalityPrompt;
  }

  private personalityPrompt: string = '';

  /**
   * Generate a 3-step analysis plan for the given topic.
   * @param topic - The topic to analyze.
   * @returns A promise that resolves to an array of plan steps.
   */
  async generateAnalysisPlan(topic: string): Promise<PlanStep[]> {
    let prompt = `${this.magiName}, consider the following inquiry: "${topic}"
    Your task is to create a concise 3-step plan of attack keeping in mind you have access to the following tool(s): ${this.toolsList}
    Here are 2 examples of how to format your plan:
    
    **Example Plan 1 (Tool Usage):** If the inquiry was "Suggest a meal for dinner", your response might look like this:`;

    // Each Magi will have different tools available to them, so we will tailor the example accordingly
    switch(this.magiName){
      case MagiName.Balthazar:
        prompt += `
        1. I have access to the web and it might be helpful for this inquiry, so I will search the web [TOOL][web-search][ARGS][dinner suggestions][easy dinners to prepare]
        2. Once I have the search results, I will need to extract the most relevant meal suggestions.
        3. Finally, I will summarize the best suggestions from the web and share with the other Magi for input.
       `;
        break;

      case MagiName.Melchior:
        prompt += `
        1. I have access to personal data and it might be helpful for this inquiry, so I will scan it [TOOL][personal-data][ARGS][food preferences][dietary restrictions][food allergies]
        2. Once I have the results, I will scan it for food preferences, dietary restrictions, and food allergy info.
        3. Finally, I will summarize relevant findings for the other Magi while minimizing sharing any personal user data.`;
        break;

      case MagiName.Caspar:
        prompt += `
        1. I have access to the user's smart home devices which might be helpful for this inquiry, so I will access them [TOOL][smart-home-devices][ARGS][kitchen appliances][food inventory][kitchen camera]
        2. Once I have the results, I will catalog the available kitchen appliances and food inventory.
        3. Finally, I will summarize the available appliances and food inventory for the other Magi to consider.
        `;
        break;
    }

    prompt += `
    Note: Only the first step may include tool usage. If you want to use the tool multiple times, append multiple arguments in brackets.
    The format is: [TOOL][tool-name][ARGS][Argument-1][Argument-2][...]
    
    **Example Plan 2 (No Tool Use Necessary):** The user's query is simple, "What is two plus two?" you should realize tool use is overkill, so your response might look like this:
    1. I will perform the simple math requested and provide my answer to the Magi.
    2. [SKIP]
    3. [SKIP]
    
    **IMPORTANT**
    Be concise and focused.
    Do not overcomplicate or overthink simple inquiries.
    Only respond with your 3-step plan in the format like the previous 2 examples.`;
    
    const systemPrompt = `${MAGI_MANIFESTO}\n\n${this.personalityPrompt}`;
    const planResponse = await this.conduitClient.contact(prompt, systemPrompt, this.model, { temperature: this.temperature });
    logger.debug(`${prompt}\n\nled to\n\n${planResponse}`);
    return this.parsePlanSteps(planResponse);
  }

  /**
   * Parse the plan response into individual steps with tool information.
   * New format: [TOOL][tool_name] and [ARGS][arg1][arg2][argN]
   * Multiple arguments result in multiple tool calls.
   * @param planResponse - The raw plan response from the AI.
   * @returns An array of parsed plan steps.
   */
  parsePlanSteps(planResponse: string): PlanStep[] {
    let steps: PlanStep[] = [];
    const lines = planResponse.split('\n');
    
    let currentStep: Partial<PlanStep> = {};
    let stepNumber = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Look for numbered steps (1., 2., 3. or 1), 2), 3))
      if (/^[123][.)]/.test(trimmed)) {
        // Save previous step if it exists
        if (currentStep.description) {
          steps.push(this.completePlanStep(currentStep, stepNumber));
        }
        
        stepNumber++;
        currentStep = {};
        
        // Parse the entire line for step description and inline tool usage
        let stepDescription = trimmed.replace(/^[123][.)]\s*/, '').trim();
        
        // Remove [STEP] prefix if present (legacy format)
        const stepMatch = stepDescription.match(/^\[STEP\]\s*(.+)/);
        if (stepMatch) {
          stepDescription = stepMatch[1].trim();
        }
        
        // Check for [SKIP] format - step should be skipped
        const skipMatch = stepDescription.match(/^\[SKIP\]\s*(.+)/);
        if (skipMatch) {
          stepDescription = skipMatch[1].trim();
          currentStep.skipped = true;
        }
        
        // Check for new format: inline [TOOL][tool_name] pattern
        const newToolMatch = stepDescription.match(/\[TOOL\]\[([^\]]+)\]/);
        if (newToolMatch) {
          currentStep.requiresTool = true;
          currentStep.toolName = newToolMatch[1].trim();
        }
        
        // Check for new format: inline [ARGS][arg1][arg2][argN] pattern - multiple arguments
        const argsMatch = stepDescription.match(/\[ARGS\](\[[^\]]*\](?:\[[^\]]*\])*)/);
        if (argsMatch) {
          // Extract all arguments from the pattern [ARGS][arg1][arg2][argN]
          const argsSection = argsMatch[1];
          const individualArgs = Array.from(argsSection.matchAll(/\[([^\]]*)\]/g))
            .map(match => match[1].trim())
            .filter(arg => arg.length > 0);
          
          if (individualArgs.length > 0) {
            // Store multiple arguments to enable multiple tool calls
            currentStep.toolArguments = { arguments: individualArgs };
          }
        }
        
        // Set defaults if tool was mentioned but args weren't found
        if (currentStep.requiresTool && !currentStep.toolArguments) {
          currentStep.toolArguments = {};
        }
        
        // Clean up description by removing structured tags only
        stepDescription = stepDescription
          .replace(/\[TOOL\]\[[^\]]+\]/g, '')
          .replace(/\[ARGS\](\[[^\]]*\](?:\[[^\]]*\])*)/g, '')
          .replace(/\[SKIP\]/g, '')
          .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
          .trim();
          
        currentStep.description = stepDescription;
        currentStep.requiresTool = currentStep.requiresTool ?? false;
      }
    }
    
    // Save the last step
    if (currentStep.description) {
      steps.push(this.completePlanStep(currentStep, stepNumber));
    }
    
    // Ensure we have exactly 3 steps, filling missing ones with skipped steps
    while (steps.length < 3) {
      steps.push({
        description: `Step ${steps.length + 1}: [Not provided - skipped]`,
        requiresTool: false,
        skipped: true
      });
    }
    
    // Truncate to 3 steps if we have more
    if (steps.length > 3) {
      return steps.slice(0, 3);
    }
    
    return steps;
  }

  /**
   * Execute the analysis plan step by step.
   * @param steps - The plan steps to execute.
   * @param originalTopic - The original inquiry topic.
   * @returns A promise that resolves to the cumulative output.
   */
  async executePlan(steps: PlanStep[], originalTopic: string): Promise<string> {
    let cumulativeOutput = '';
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;
      
      logger.debug(`${this.magiName} executing step ${stepNumber}: ${step.description}`, {
        requiresTool: step.requiresTool,
        toolName: step.toolName,
        toolArguments: step.toolArguments,
        skipped: step.skipped
      });
      
      try {
        // Check if this step should be skipped
        if (step.skipped) {
          logger.debug(`${this.magiName} skipping step ${stepNumber}`);
          cumulativeOutput += `\n\nStep ${stepNumber} Result:\n[Step skipped - not required for this analysis]`;
        } else {
          // Execute the step (with tool usage if needed)
          const stepResult = await this.executeStep(step, stepNumber, cumulativeOutput, originalTopic);
          cumulativeOutput += `\n\nStep ${stepNumber} Result:\n${stepResult}`;
        }
        
        logger.debug(`${this.magiName} completed step ${stepNumber}`);
      } catch (error) {
        logger.error(`${this.magiName} failed at step ${stepNumber}:`, error);
        // Continue with a fallback approach
        cumulativeOutput += `\n\nStep ${stepNumber} Result:\n[Step failed - continuing with available information]`;
      }
    }
    
    return cumulativeOutput;
  }

  /**
   * Execute a single step of the analysis plan.
   * @param step - The step to execute.
   * @param stepNumber - The step number.
   * @param previousOutput - The cumulative output from previous steps.
   * @param originalTopic - The original inquiry topic.
   * @returns A promise that resolves to the step result.
   */
  private async executeStep(
    step: PlanStep, 
    stepNumber: number, 
    previousOutput: string, 
    originalTopic: string
  ): Promise<string> {
    // Check if this step requires tool usage
    if (step.requiresTool && step.toolName && step.toolArguments) {
      // Check if we have multiple arguments that require multiple tool calls
      if (step.toolArguments.arguments && Array.isArray(step.toolArguments.arguments)) {
        const results: string[] = [];
        
        // Execute tool call for each argument
        for (const argument of step.toolArguments.arguments) {
          const toolResult = await this.toolUser.executeWithTool(
            step.toolName, 
            { query: argument }, 
            step.description
          );
          results.push(`Result for "${argument}": ${toolResult}`);
        }
        
        return results.join('\n\n');
      } else {
        // Single tool call with existing arguments
        const toolResult = await this.toolUser.executeWithTool(
          step.toolName, 
          step.toolArguments, 
          step.description
        );
        return toolResult;
      }
    } else {
      // Execute with simple reasoning (bypass mechanism)
      const reasoningPrompt = `${this.magiName}, you are executing step ${stepNumber} of your analysis plan: "${step.description}"
      
      Original inquiry: "${originalTopic}"
      Previous analysis: ${previousOutput || 'None'}
      
      Please complete this step based on your reasoning and knowledge. Be concise and focused.`;
      
      const systemPrompt = `${MAGI_MANIFESTO}\n\n${this.personalityPrompt}`;
      return await this.conduitClient.contact(reasoningPrompt, systemPrompt, this.model, { temperature: this.temperature });
    }
  }

  /**
   * Synthesize the final response from analysis results.
   * @param analysisResult - The cumulative analysis results.
   * @param originalTopic - The original inquiry topic.
   * @returns A promise that resolves to the synthesized response.
   */
  async synthesizeResponse(analysisResult: string, originalTopic: string): Promise<string> {
    const synthesisPrompt = `${this.magiName}, you have completed your independent analysis of the inquiry: "${originalTopic}"
    
    Your analysis results:
    ${analysisResult}
    
    Please synthesize a concise, well-reasoned response that directly addresses the original inquiry. 
    Focus on the key insights from your analysis and present them clearly. Be concise but thorough.`;
    
    const systemPrompt = `${MAGI_MANIFESTO}\n\n${this.personalityPrompt}`;
    return await this.conduitClient.contact(synthesisPrompt, systemPrompt, this.model, { temperature: this.temperature });
  }

  /**
   * Complete a partial plan step with defaults.
   * @param partial - The partial plan step.
   * @param stepNumber - The step number.
   * @returns A complete plan step.
   */
  private completePlanStep(partial: Partial<PlanStep>, stepNumber: number): PlanStep {
    return {
      description: partial.description || `Step ${stepNumber}: Perform analysis`,
      requiresTool: partial.requiresTool ?? false,
      toolName: partial.toolName,
      toolArguments: partial.toolArguments,
      skipped: partial.skipped ?? false
    };
  }

}