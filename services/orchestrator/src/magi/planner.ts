import { logger } from '../logger';
import { MagiName } from './magi';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Model } from '../config';

/**
 * Custom error types for better error handling
 */
export class PlanParsingError extends Error {
  constructor(message: string, public readonly planData?: string) {
    super(message);
    this.name = 'PlanParsingError';
  }
}

export class StepExecutionError extends Error {
  constructor(message: string, public readonly stepNumber: number, public readonly stepType?: StepType) {
    super(message);
    this.name = 'StepExecutionError';
  }
}

export const DEFAULT_PLAN_JSON = 
`    {
      "Step1": {
        "instruction": "respond with the answer to the simple question"
      }
    }`;

/**
 * Maximum number of steps allowed in a plan to prevent runaway planning
 */
const MAX_PLAN_STEPS = 20;

/**
 * Types of plan steps for execution control
 */
export enum StepType {
  PLAN_CREATION = 'plan_creation',
  PLAN_EXPANSION = 'plan_expansion',
  PLAN_EXECUTION = 'plan_execution',
}

/**
 * Enhanced plan step with tool information
 */
export interface PlanStep {
  instruction: string;
  toolName?: string;
  toolArguments?: string[];
  type?: StepType;
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
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "args": "${parameterName || 'query'}" } }`;
    }).join('\n');
  }

  /**
   * Returns a fresh copy of the initial plan so each Magi has its own copy
   * @returns A new array with the initial plan steps
   */
  static getSeedPlan(): PlanStep[] {
    return [
      { instruction: 'Create response plan for inquiry', type: StepType.PLAN_CREATION },
      { instruction: 'Execute custom plan', type: StepType.PLAN_EXPANSION }
    ];
  }


  /**
   * Generate raw LLM response for creating a plan for the given inquiry.
   * @param inquiry - The inquiry to analyze.
   * @returns A promise that resolves to the raw LLM response.
   */
  async createResponsePlan(inquiry: string): Promise<string> {
    let prompt = `
    INSTRUCTIONS:
    Your task is to create a concise multi-step plan of how you will address the inquiry.
    Keep your plan focused and efficient - aim for 3-8 steps maximum, never exceed 15 steps.
    The output of each step will be fed into the next step.
    If any of the steps require using a tool, you must specify the tool name and arguments in that step.
    The tool name must match the name of the one of the tools you have access to.
    You can provide one or more arguments to the tool in the "args" array.
    Here are the tools you have access to:
    ${this.toolsList}
    
    Below are examples of different inquiries and how your plan should look:
    
    INQUIRY: "What should I make for dinner that is simple and healthy?"`;

    // Each Magi will have different tools available to them, so we will tailor the example accordingly
    switch(this.magiName){
      case MagiName.Balthazar:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "instruction": "Search the web for dinner related option from reputable sources",
            "tool": {
              "name": "web-search",
              "args": [
                "dinner suggestions",
                "easy meals to prepare"
              ]
            }
          },
          "Step2": {
            "instruction": "extract the most relevant meal suggestions from the search results."
          },
          "Step3": {
            "instruction": "filter out meal suggestions that are complex or unhealthy"
          },
          "Step4": {
            "instruction": "summarize the remaining meal suggestions and include a justification based on popularity from the web"
          }
        }
       \`\`\``;
        break;

      case MagiName.Melchior:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "instruction": "Determine if the user has any food-related information on file",
            "tool": {
              "name": "personal-data",
              "args": [
                "food preferences",
                "dietary restrictions",
                "food allergies"
              ]
            }
          },
          "Step2": {
            "instruction": "Propose a list of popular simple and healthy meal options that fit food preferences, allergies, and dietary restrictions",
          },
          "Step3": {
            "instruction": "Summarize the remaining meal options and include a justification based on the user's preferences, allergies, and dietary restrictions if any."
          }
        }
        \`\`\``;
        break;

      case MagiName.Caspar:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "instruction": "access smart home devices to gather kitchen and food information",
            "tool": {
              "name": "smart-home-devices",
              "args": [
                "kitchen appliances",
                "food inventory",
                "kitchen camera"
              ]
            }
          },
          "Step2": {
            "instruction": "If food inventory is available, identify what ingredients are on hand to inform meal suggestions",
          },
          "Step3": {
            "instruction": "If kitchen appliances are available, identify what cooking equipment can be used to prepare meals"
          },
          "Step4": {
            "instruction": "If kitchen camera is available, identify any visible food items that could be used for meal suggestions",
          },
          "Step5": {
            "instruction": "summarize the available appliances and food inventory for the other Magi to consider"
          }
        }
        \`\`\``;
        break;
    }

    prompt += `
    INQUIRY: "What is two plus two?"
    \`\`\`json
    ${DEFAULT_PLAN_JSON}
    \`\`\`

    Now ${this.magiName}, what would be your plan for responding to the following inquiry based on how the above questions were handled?
    Only respond with the JSON plan, do not include any other text.

    INQUIRY: "${inquiry}"`;
    
    const planResponse = await this.conduitClient.contact(prompt, (this.conduitClient as any).getPersonality(), this.model, { temperature: this.temperature });
    
    return planResponse;
  }

  /**
   * Review the plan response and format it as proper JSON
   * NOTE: Currently unused - Magi produce good JSON directly, but kept for potential future enhancements
   * @param originalInquiry - The original inquiry (currently unused, reserved for future review logic)
   * @param maybeJSON - The text that might contain JSON
   * @returns A promise that resolves to a well-formatted JSON string.
   */
  /* async reviewPlan(originalInquiry: string, maybeJSON: string): Promise<string> {
    logger.debug(`After review:\n${maybeJSON}`);
    const isValidJSON = (str: string): boolean => {
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    };

    // Try to extract JSON from the response, handling markdown code blocks
    let jsonString = '';

    // First, try to find JSON within markdown code blocks
    const markdownJsonMatch = maybeJSON.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (markdownJsonMatch) {
      jsonString = markdownJsonMatch[1];
    } else {
      // Fall back to finding raw JSON
      const jsonMatch = maybeJSON.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in plan response, returning default plan');
        return DEFAULT_PLAN_JSON;
      }
      jsonString = jsonMatch[0];
    }

    const reviewerPersonality = 'You are an expert planner and JSON afficiando';

    const reviewPlanPrompt = `
    Consider the following JSON plan, and pay special attention to the instructions:
    ${jsonString}

    Your task is to ensure that the plan, if followed step by step will properly address the inquiry: "${originalInquiry}"
    You may only make modification to the instruction text or overall JSON formatting.
    It is absolutolutely essential that you make sure the JSON formatting is correct.
    Only respond with the final JSON from your review, do not include any other text.`;
    
    jsonString = await this.conduitClient.contact(reviewPlanPrompt, reviewerPersonality, this.model, { temperature: 1 });

    // Make sure its valid 
    if (!isValidJSON(jsonString)) {
      return DEFAULT_PLAN_JSON
    }
    logger.debug(`After review:\n${jsonString}`);

    return jsonString;
  } */

  /**
   * Parse the plan response into individual steps with tool information.
   * Expects JSON with Step1, Step2, StepN... keys (variable number of steps)
   * @param planJSON - The raw plan response from the AI.
   * @returns A promise that resolves to an array of parsed plan steps.
   */
  async parsePlanSteps(planJSON: string): Promise<PlanStep[]> {
    try {
      const planData = JSON.parse(planJSON);

      // Convert planData to array of steps using functional approach
      const allStepEntries = Object.entries(planData)
        .filter(([key, stepData]) => 
          key.match(/^Step\d+$/) && stepData && (stepData as any).instruction
        )
        .sort(([keyA], [keyB]) => {
          const numA = parseInt(keyA.replace('Step', ''));
          const numB = parseInt(keyB.replace('Step', ''));
          return numA - numB;
        });

      // Check if plan exceeds maximum steps and log warning if so
      if (allStepEntries.length > MAX_PLAN_STEPS) {
        logger.warn(`Plan exceeded ${MAX_PLAN_STEPS} steps (found ${allStepEntries.length}), truncating to first ${MAX_PLAN_STEPS} steps`);
      }

      // Truncate to maximum steps and convert to PlanStep objects
      const steps = allStepEntries
        .slice(0, MAX_PLAN_STEPS)
        .map(([, stepData]) => {
          const data = stepData as any;
          const step: PlanStep = {
            instruction: data.instruction,
            type: StepType.PLAN_EXECUTION
          };
          
          // Add tool information if present
          if (data.tool) {
            step.toolName = data.tool.name;
            if (data.tool.args && Array.isArray(data.tool.args)) {
              step.toolArguments = data.tool.args;
            }
          }
          
          return step;
        });

      return steps;
      
    } catch (error) {
      const parseError = new PlanParsingError('Failed to parse JSON plan response', planJSON);
      logger.warn('Failed to parse JSON plan response:', parseError);
      return [
        { instruction: 'Respond to the inquiry directly', type: StepType.PLAN_EXECUTION }
      ];
    }
  }

  /**
   * Execute the analysis plan step by step.
   * @param steps - The plan steps to execute (may be modified by plan expansion).
   * @param originalInquiry - The original inquiry.
   * @returns A promise that resolves to the cumulative output.
   */
  async executePlan(steps: PlanStep[], originalInquiry: string): Promise<string> {
    let cumulativeOutput = '';
    let rawPlanResponse = '';
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;
      logger.debug(`${this.magiName} performing ${stepNumber}`);
      try {
        let stepResult = '';
        
        switch (step.type) {
          // The Magi is creating the plan based on the inquiry
          case StepType.PLAN_CREATION:
            stepResult = await this.createResponsePlan(originalInquiry);
            rawPlanResponse = stepResult;
            break;
          
          case StepType.PLAN_EXPANSION:
            // Here we append to the current plan with the Magi's generated plan
            const parsedSteps = await this.parsePlanSteps(rawPlanResponse);
            stepResult = `Parsed ${parsedSteps.length} plan step(s)`;
            
            if (parsedSteps.length > 0) {
              steps.push(...parsedSteps);
              logger.debug(`${this.magiName} expanded plan with ${parsedSteps.length} additional steps`);
            }
            break;
          
          case StepType.PLAN_EXECUTION:
          default:
            stepResult = await this.executeStep(step, stepNumber, cumulativeOutput, originalInquiry, steps);
            break;
        }
        
        cumulativeOutput += `\n\nStep ${stepNumber} Result:\n${stepResult}`;
        
        logger.debug(`${this.magiName} completed step ${stepNumber}`);
      } catch (error) {
        const stepError = new StepExecutionError(
          `Step ${stepNumber} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          stepNumber,
          step.type
        );
        logger.error(`${this.magiName} failed at step ${stepNumber}:`, stepError);
        // Continue with a fallback approach
        cumulativeOutput += `\n\nStep ${stepNumber} Result:\n[Step failed - continuing with available information]`;
      }
    }
    
    return cumulativeOutput;
  }

  /**
   * Execute a single regular step of the analysis plan with full context.
   * @param step - The step to execute.
   * @param stepNumber - The step number.
   * @param previousOutput - The cumulative output from previous steps.
   * @param originalInquiry - The original inquiry.
   * @param fullPlan - The complete plan for context.
   * @returns A promise that resolves to the step result.
   */
  private async executeStep(
    step: PlanStep, 
    stepNumber: number, 
    previousOutput: string, 
    originalInquiry: string,
    fullPlan: PlanStep[]
  ): Promise<string> {
    // Check if this step requires tool usage
    if (step.toolName && step.toolArguments) {
      // Execute tool call for each argument (handles single or multiple)
      const results: string[] = [];
      
      for (const argument of step.toolArguments) {
        const toolResult = await this.toolUser.executeWithTool(
          step.toolName, 
          { query: argument }, 
          step.instruction
        );
        results.push(step.toolArguments.length > 1 ? `Result for "${argument}": ${toolResult}` : toolResult);
      }
      
      return results.join('\n\n');
    } else {
      // Execute with simple reasoning (bypass mechanism)
      const planContext = fullPlan.map((planStep, index) => 
        `Step ${index + 1}${index + 1 === stepNumber ? ' (CURRENT)' : ''}: ${planStep.instruction}${planStep.toolName ? ` [Tool: ${planStep.toolName}]` : ''}`
      ).join('\n');
      
      const stepExecutionPrompt = `${this.magiName}, you are executing step ${stepNumber} of your plan:\n"${step.instruction}"
      
      FULL PLAN CONTEXT:
      ${planContext}
      
      This is ultimately to address the inquiry: "${originalInquiry}"
      Here is the relevant information from previous steps: ${previousOutput || 'None'}
      
      Execute this step with the full plan context in mind.
      The output of this step will feed into the next step.
      If this is the last step, the results will be shared with the other Magi.`;
      
      return await this.conduitClient.contact(stepExecutionPrompt, (this.conduitClient as any).getPersonality(), this.model, { temperature: this.temperature });
    }
  }
}