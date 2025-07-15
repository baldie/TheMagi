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
      "Step3": {
        "instruction": "respond directly to the simple inquiry with a concise answer"
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
  toolParameters?: Record<string, any>;
  type?: StepType;
}

/**
 * Planner handles plan generation, parsing, and execution for the Magi system.
 */
export class Planner {
  private toolsList: string = '';
  
  constructor(
    private magiName: MagiName,
    private conduitClient: ConduitClient,
    private toolUser: ToolUser,
    private model: Model,
    private temperature: number
  ) {
    // Tools list will be initialized asynchronously
  }
  
  /**
   * Initialize the planner with async tools list
   */
  async initialize(): Promise<void> {
    const tools = await this.toolUser.getAvailableTools();
    this.toolsList = tools.map(t => {
      // Extract actual parameter names and types from JSON Schema
      const parameters = this.extractParameterDetails(t.inputSchema);
      
      // Format parameters as readable string instead of object
      const paramString = Object.entries(parameters)
        .map(([name, type]) => `"${name}":"${type}"`)
        .join(',');
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }`;
    }).join('\n');
  }

  /**
   * Extract parameter details from JSON Schema for MCP format
   */
  private extractParameterDetails(inputSchema: Record<string, any> | undefined): Record<string, string> {
    if (!inputSchema?.properties) {
      return { query: 'string (required)' };
    }

    const properties = inputSchema.properties;
    const required = inputSchema.required || [];
    
    const parameters: Record<string, string> = {};
    
    Object.entries(properties).forEach(([name, schema]: [string, any]) => {
      const type = schema.type || 'any';
      const isRequired = required.includes(name);
      const defaultValue = schema.default !== undefined ? `, default: ${JSON.stringify(schema.default)}` : '';
      const status = isRequired ? 'required' : 'optional';
      
      // Special handling for common parameter patterns
      let description = '';
      if (name === 'options' && type === 'object') {
        description = ' - Configure search depth, topic, max results, etc.';
      } else if (name === 'urls' && type === 'array') {
        description = ' - List of URLs to process (up to 20)';
      } else if (name === 'query') {
        description = ' - Search query or question';
      } else if (name === 'url') {
        description = ' - URL to crawl';
      } else if (name === 'include_content') {
        description = ' - Whether to include full content';
      }
      
      parameters[name] = `${type} (${status}${defaultValue})${description}`;
    });

    return parameters;
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
    Keep your plan focused and efficient - aim for 3-8 steps maximum.
    Never exceed ${MAX_PLAN_STEPS} steps and always start on Step3 (Step1 and Step2 are reserved).
    The output of each step will be fed into the next step.
    If any of the steps require using a tool, you must specify the tool name and arguments in that step.
    The tool name must match the name of the one of the tools you have access to.
    You can provide one or more arguments to the tool in the "args" array. Each argument will be executed as a separate tool call.
    Use the parameter information to provide the correct argument names and types.
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
          "Step3": {
            "instruction": "Search the web for dinner options from reputable sources",
            "tool": {
              "name": "web_search",
              "args": {
                "query": "healthy simple dinner options",
                "options": {
                  "search_depth": "advanced",
                  "max_results": 5,
                  "include_answer": true,
                  "include_images": false
                }
              }
            }
          },
          "Step4": {
            "instruction": "Evaluate the search results and respond with the most promising recipe, and respond the URL",
          },
          "Step5": {
            "instruction": "Use crawl_url to get detailed content from the URL found in previous step",
            "tool": {
              "name": "crawl_url",
              "args": {
                "url": "<INSERT_URL_FROM_PREVIOUS_STEP_HERE>",
                "include_content": true
              }
            }
          },
          "Step6": {
            "instruction": "Summarize the meal suggestions and recipes and include where you found them for the other Magi to consider"
          }
        }
        \`\`\``
        break;

      case MagiName.Melchior:
        prompt += `
        \`\`\`json
        {
          "Step3": {
            "instruction": "Gather any food-related information on file for the user",
            "tool": {
              "name": "personal-data",
              "args": {
                "categories": ["food preferences", "dietary restrictions", "food allergies"],
                "user_context": "gathering meal planning information"
              }
            }
          },
          "Step4": {
            "instruction": "Propose a list of popular simple and healthy meal options that fit the retrieved food preferences, allergies, and dietary restrictions"
          },
          "Step5": {
            "instruction": "Summarize the remaining meal options and include a justification based on the user's preferences, allergies, and dietary restrictions for the other Magi to consider"
          }
        }
        \`\`\``;
        break;

      // TODO: what if Caspar wants to turn on the kitchen lights (and then turn them back off)? that would change the plan mid-stream
      case MagiName.Caspar:
        prompt += `
        \`\`\`json
        {
          "Step3": {
            "instruction": "access smart home devices to gather current kitchen and food information",
            "tool": {
              "name": "smart-home-devices",
              "args": {
                "device_types": ["smart_fridge", "kitchen_lights", "kitchen_camera"],
                "query_purpose": "meal planning assistance"
              }
            }
          },
          "Step5": {
            "instruction": "If smart fridge is, what ingredients are available? Share ingredients, expiration dates, and quantities to next step"
          },
          "Step6": {
            "instruction": "If kitchen camera is available, identify if the kitchen is available. Share ingredients, available appliances, and kitchen condition to next step"
          },
          "Step7": {
            "instruction": "summarize the available ingredients, appliances, and kitchen condition for the other Magi to consider"
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
    Only respond with the **properly formatted** JSON plan, do not include any other text.
    IMPORTANT: Ensure valid JSON syntax - no trailing commas after the last property in any object.

    INQUIRY: "${inquiry}"`;
    
    //logger.debug(prompt);
    const planData = await this.conduitClient.contactForJSON(prompt, (this.conduitClient as any).getPersonality(), this.model, { temperature: this.temperature });
    
    return JSON.stringify(planData);
  }


  /**
   * Convert step data object to PlanStep format
   * @param stepData - Raw step data from JSON
   * @returns PlanStep object
   */
  private convertStepDataToPlanStep(stepData: any): PlanStep {
    const step: PlanStep = {
      instruction: stepData.instruction,
      type: StepType.PLAN_EXECUTION
    };
    
    // Add tool information if present
    if (stepData.tool) {
      step.toolName = stepData.tool.name;
      if (stepData.tool.args && typeof stepData.tool.args === 'object') {
        step.toolParameters = stepData.tool.args;
      }
    }
    
    return step;
  }

  /**
   * Parse the plan response into individual steps with tool information.
   * Expects JSON with Step1, Step2, StepN... keys (variable number of steps)
   * @param planData - The parsed plan data from the AI.
   * @returns A promise that resolves to an array of parsed plan steps.
   */
  async parsePlanSteps(planData: any): Promise<PlanStep[]> {
    try {

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

      logger.debug(`${this.magiName} found ${allStepEntries.length} valid step entries`);

      // Check if plan exceeds maximum steps and log warning if so
      if (allStepEntries.length > MAX_PLAN_STEPS) {
        logger.warn(`Plan exceeded ${MAX_PLAN_STEPS} steps (found ${allStepEntries.length}), truncating to first ${MAX_PLAN_STEPS} steps`);
      }

      // Truncate to maximum steps and convert to PlanStep objects
      const steps = allStepEntries
        .slice(0, MAX_PLAN_STEPS)
        .map(([, stepData]) => this.convertStepDataToPlanStep(stepData as any));

      logger.debug(`${this.magiName} created ${steps.length} plan steps`);
      return steps;
      
    } catch (error) {
      logger.error(`${this.magiName} falling back to default plan due to step processing failure:`, error);
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
            rawPlanResponse = JSON.parse(stepResult);
            break;
          
          case StepType.PLAN_EXPANSION: {
            // Here we append the Magi's generated plan to the currently executing plan
            const parsedSteps = await this.parsePlanSteps(rawPlanResponse);
            stepResult = `Updated ${this.magiName}'s plan with ${parsedSteps.length} additional step(s)`;
            
            if (parsedSteps.length > 0) {
              steps.push(...parsedSteps);
            }
            break;
          }
          
          case StepType.PLAN_EXECUTION:
          default:
            // Clear previous result if this is the first execution step after plan creation
            const firstMagiCreatedStep = (i > 0 && steps[i - 1].type === StepType.PLAN_EXPANSION);
            stepResult = firstMagiCreatedStep ? '' : stepResult;

            // Execute the Magi provided step that they created
            stepResult = await this.executeStep(step, stepNumber, stepResult, originalInquiry, steps);
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
   * Hydrate tool step using LLM with previous step output
   * @param step - The step with tool parameters to hydrate
   * @param previousOutput - Output from previous steps
   * @param originalInquiry - The original inquiry for context
   * @returns Promise resolving to updated PlanStep or original on failure
   */
  private async hydrateToolParameters(
    step: PlanStep,
    previousOutput: string,
    originalInquiry: string
  ): Promise<PlanStep> {
    try {
      logger.debug(`${this.magiName} hydrating tool step for ${step.toolName}...`);
      
      // Convert current step back to JSON format for the prompt
      const originalStepJson = {
        "ToolStep": {
          instruction: step.instruction,
          tool: {
            name: step.toolName,
            args: step.toolParameters
          }
        }
      };
      
      const hydrationPrompt = `You need to update a tool step based on previous step output.

ORIGINAL INQUIRY: "${originalInquiry}"

ORIGINAL TOOL STEP JSON:\n
\`\`\`json
${JSON.stringify(originalStepJson, null, 2)}\n
\`\`\`

PREVIOUS STEP OUTPUT:\n
------------------------------------------------------
${previousOutput}\n
------------------------------------------------------

Your task: Update the original tool step JSON by incorporating relevant information into the arguments from the previous step output.
- Keep parameters that don't need to be modified unchanged
- Update parameters that should use data from previous step output (see step instructions)
- Ensure all required parameters are present and properly formatted
- Maintain the exact same JSON structure and format

Respond with ONLY the properly formatted JSON`;

      logger.debug(`${this.magiName} sending hydration prompt:\n${hydrationPrompt}`);
      const hydratedStepData = await this.conduitClient.contactForJSON(
        hydrationPrompt, 
        '', // No specific personality needed for parameter hydration
        this.model, 
        { temperature: 0.1 } // Low temperature for consistent parameter extraction
      );
      logger.debug(`Hydration result:\n${JSON.stringify(hydratedStepData)}`);

      // Extract the step data from the response
      const stepData = (hydratedStepData.ToolStep)
        ? hydratedStepData.ToolStep
        : hydratedStepData;
      
      const hydratedStep = this.convertStepDataToPlanStep(stepData);
      logger.debug(`${this.magiName} successfully hydrated tool step:`, hydratedStep);
      return hydratedStep;
      
    } catch (error) {
      logger.warn(`${this.magiName} failed to hydrate tool step, using original:`, error);
      return step;
    }
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
    if (step.toolName && step.toolParameters) {

      // Hydrate tool with parameters from previous step if needed
      let updatedStep = step;
      if (previousOutput?.trim()) {
        updatedStep = await this.hydrateToolParameters(step, previousOutput, originalInquiry);
      }
      
      // Execute tool call with hydrated MCP parameters
      const toolResult = await this.toolUser.executeWithTool(
        updatedStep.toolName!, 
        updatedStep.toolParameters!, 
        updatedStep.instruction
      );
      
      return `In completing instructions "${updatedStep.instruction}":\n\n${toolResult}`;
    } else {
      // Summarzie plan
      const planContext = fullPlan.map((planStep, index) => 
        `Step ${index + 1}${index + 1 === stepNumber ? ' (CURRENT)' : ''}: ${planStep.instruction}${planStep.toolName ? ` [Tool: ${planStep.toolName}]` : ''}`
      ).join('\n');
      
      const stepExecutionPrompt = `${this.magiName}, your original plan for addressing the inquiry is as follows:
      ${planContext}

      You are now executing executing step ${stepNumber} of your plan, therefore your current instructions are:\n"${step.instruction}"
      This is ultimately to address the inquiry: "${originalInquiry}"
      Here is the relevant information from previous step(s): ${previousOutput || 'None'}
      
      Execute this step with the full plan context in mind.
      The output of this step will feed into the next step.
      If this is the last step, the results will be shared with the other Magi.`;
      
      return await this.conduitClient.contact(stepExecutionPrompt, (this.conduitClient as any).getPersonality(), this.model, { temperature: this.temperature });
    }
  }
}