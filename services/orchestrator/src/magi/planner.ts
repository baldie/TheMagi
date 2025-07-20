import { logger } from '../logger';
import { MagiName } from './magi';
import { ConduitClient } from './conduit-client';
import { getCleanExtractPrompt, ToolUser } from './tool-user';
import { ToolRegistry, EXCLUDED_TOOL_PARAMS } from '../mcp/tools/tool-registry';
import { Model } from '../config';

/**
 * JSON Schema type definitions
 */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Raw step data from JSON parsing
 */
interface RawStepData {
  instruction: string;
  tool?: {
    name: string;
    args?: Record<string, unknown>;
  };
}

/**
 * Raw plan data containing multiple steps
 */
interface RawPlanData {
  [key: string]: RawStepData | unknown;
}

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
  toolParameters?: Record<string, unknown>;
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
        .filter(([name]) => !EXCLUDED_TOOL_PARAMS.has(name))
        .map(([name, type]) => `"${name}":"${type}"`)
        .join(',');
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }
USAGE:\n${t.instructions || 'Infer instructions based on parameter names'}`;
    }).join('\n');
  }

  /**
   * Extract parameter details from JSON Schema for MCP format
   */
  private extractParameterDetails(inputSchema: JsonSchema | undefined): Record<string, string> {
    if (!inputSchema?.properties) {
      return { query: 'string (required)' };
    }

    const properties = inputSchema.properties;
    const required = inputSchema.required || [];
    
    const parameters: Record<string, string> = {};
    
    Object.entries(properties).forEach(([name, schema]: [string, JsonSchemaProperty]) => {
      const type = schema.type || 'any';
      const isRequired = required.includes(name);
      const defaultValue = schema.default !== undefined ? `, default: ${JSON.stringify(schema.default)}` : '';
      const status = isRequired ? 'required' : 'optional';
      
      // Include enum constraints if present
      const enumConstraint = schema.enum ? ` [options: ${schema.enum.map(v => `"${v}"`).join('|')}]` : '';
      
      // Special handling for common parameter patterns
      let description = '';
      if (name === 'options' && type === 'object') {
        // Check for nested topic enum in options object
        const topicProperty = schema.properties?.topic;
        const topicEnum = topicProperty?.enum ? `topic must be one of: ${topicProperty.enum.map(v => `"${v}"`).join('|')}. ` : '';
        description = ` - Configure search depth, topic, max results, etc. ${topicEnum}`;
      } else if (name === 'urls' && type === 'array') {
        description = ' - List of URLs to process (up to 20)';
      } else if (name === 'query') {
        description = ' - Search query or question';
      } else if (name === 'url') {
        description = ' - URL to crawl';
      } else if (name === 'include_content') {
        description = ' - Whether to include full content';
      }
      
      parameters[name] = `${type} (${status}${defaultValue})${enumConstraint}${description}`;
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
    Your task is to create a concise multi-step plan of how you will address an inquiry.
    Keep your plan focused and efficient - aim for 3-8 steps maximum.
    Never exceed ${MAX_PLAN_STEPS} steps and always start on Step3 (Step1 and Step2 are reserved).
    
    CRITICAL: The execution of this plan is a sequential process. The output or results generated by each step will be directly consumed as input by the immediate next step. Think of it as a pipeline where data flows from one stage to the next.

    Therefore, if a later step requires specific information (like URLs or extracted text) that is produced by an earlier step, you MUST use the <PLACEHOLDER> token. This <PLACEHOLDER> signifies that the exact content from the preceding step's output will be dynamically inserted at that point during execution. Do NOT guess or hardcode values for information that will be generated dynamically.

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
              "name": "tavily-search",
              "args": {
                "query": "healthy simple dinner options",
                "max_results": 3,
                "topic": "general",
                "include_answer": true
              }
            }
          },
          "Step4": {
            "instruction": "Evaluate the search results from the previous step. Select the most promising URL(s) for a healthy and simple recipe. Provide these URL(s) as the direct output of this step, which will be consumed by the next step.",
          },
          "Step5": {
            "instruction": "Use the tavily-extract tool to get detailed content from the URL(s) provided in the previous step's output.",
            "tool": {
              "name": "tavily-extract",
              "args": {
                "urls": "<PLACEHOLDER>"
              }
            }
          },
          "Step6": {
            "instruction": "Summarize the meal suggestions and recipes from the extracted content of the previous step. Include clear citations (where you found them) for the other Magi to consider."
          }
        }
        \`\`\``
        break;

      case MagiName.Melchior:
        prompt += `
        \`\`\`json
        {
          "Step3": {
            "instruction": "Gather any food-related information on file for the user. The output of this step will be the user's food preferences, dietary restrictions, and food allergies.",
            "tool": {
              "name": "personal-data",
              "args": {
                "categories": ["food preferences", "dietary restrictions", "food allergies"],
                "user_context": "gathering meal planning information"
              }
            }
          },
          "Step4": {
            "instruction": "Based on the food-related information retrieved from the previous step, propose a list of popular, simple, and healthy meal options that fit the user's preferences, allergies, and dietary restrictions. The output of this step will be this filtered list of meal options.",
            "tool": {
              "name": "tavily-search",
              "args": {
                "query": "simple healthy meal options based on <PLACEHOLDER>",
                "max_results": 5,
                "include_answer": true
              }
            }
          },
          "Step5": {
            "instruction": "From the list of meal options generated in the previous step, summarize the most suitable ones and include a justification for each based on the user's preferences, allergies, and dietary restrictions. This summary, along with the justifications, will be presented for the other Magi to consider."
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
            "instruction": "Access smart home devices to gather current kitchen and food information. The output of this step will be the raw data retrieved from all specified devices (e.g., smart fridge contents, kitchen camera status).",
            "tool": {
              "name": "smart-home-devices",
              "args": {
                "device_types": ["smart_fridge", "kitchen_lights", "kitchen_camera"],
                "query_purpose": "meal planning assistance"
              }
            }
          },
          "Step4": {
            "instruction": "Process the raw data received from the smart home devices in the previous step. Identify and extract specific details: if a smart fridge is available, list its ingredients, expiration dates, and quantities; if a kitchen camera is available, assess if the kitchen is clear and identify any visible appliances. The output of this step will be a structured collection of all identified ingredients with their details, available appliances, and the current kitchen condition.",
            "tool": null
          },
          "Step5": {
            "instruction": "Summarize the available ingredients, appliances, and the kitchen's condition, derived from the structured collection in the previous step, for the other Magi to consider."
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
    
    logger.debug(prompt);
    const planData = await this.conduitClient.contactForJSON(prompt, '', this.model, { temperature: this.temperature });
    
    return JSON.stringify(planData);
  }


  /**
   * Convert step data object to PlanStep format
   * @param stepData - Raw step data from JSON
   * @returns PlanStep object
   */
  private convertStepDataToPlanStep(stepData: RawStepData): PlanStep {
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
  async parsePlanSteps(planData: RawPlanData): Promise<PlanStep[]> {
    try {

      // Convert planData to array of steps using functional approach
      const allStepEntries = Object.entries(planData)
        .filter(([key, stepData]) => 
          key.match(/^Step\d+$/) && stepData && 
          typeof stepData === 'object' && stepData !== null &&
          'instruction' in stepData
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
        .map(([, stepData]) => this.convertStepDataToPlanStep(stepData as RawStepData));

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
    let rawPlanResponse: RawPlanData | null = null;
    let previousStepOutput = ''; // Track output from previous step to pass to next step
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;
      logger.debug(`${this.magiName} performing step ${stepNumber}`);
      try {
        let stepResult = '';
        
        switch (step.type) {
          // The Magi is creating the plan based on the inquiry
          case StepType.PLAN_CREATION:
            stepResult = await this.createResponsePlan(originalInquiry);
            rawPlanResponse = JSON.parse(stepResult) as RawPlanData;
            break;
          
          case StepType.PLAN_EXPANSION: {
            // Here we append the Magi's generated plan to the currently executing plan
            const parsedSteps = rawPlanResponse ? await this.parsePlanSteps(rawPlanResponse) : [];
            stepResult = `Updated ${this.magiName}'s plan with ${parsedSteps.length} additional step(s)`;
            
            if (parsedSteps.length > 0) {
              steps.push(...parsedSteps);
            }
            break;
          }
          
          case StepType.PLAN_EXECUTION:
          default: {
            // Clear previous result if this is the first execution step after plan creation
            const firstMagiCreatedStep = (i > 0 && steps[i - 1].type === StepType.PLAN_EXPANSION);
            previousStepOutput = firstMagiCreatedStep ? '' : previousStepOutput;

            // Execute the step with output from the previous step
            stepResult = await this.executeStep(step, stepNumber, previousStepOutput, originalInquiry, steps);
            break;
          }
        }
        
        // Update previousStepOutput for the next step
        previousStepOutput = stepResult;
        
        // Keep cumulative output for Balthazar's logging purposes
        cumulativeOutput += `\n\nStep ${stepNumber} Result:\n${stepResult}`;
        
        if (this.magiName === MagiName.Balthazar) {
          logger.debug(`${this.magiName} completed step ${stepNumber} with result:\n${stepResult}`);
        }
      } catch (error) {
        const stepError = new StepExecutionError(
          `Step ${stepNumber} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          stepNumber,
          step.type
        );
        logger.error(`${this.magiName} failed at step ${stepNumber}:`, stepError);
        // Continue with a fallback approach
        const fallbackMessage = '[Step failed - continuing with available information]';
        previousStepOutput = fallbackMessage;
        cumulativeOutput += `\n\nStep ${stepNumber} Result:\n${fallbackMessage}`;
      }
    }
    
    return cumulativeOutput;
  }

  /**
   * Validate and correct tool parameters to ensure they meet schema requirements
   * @param toolName - The name of the tool being executed
   * @param parameters - The parameters to validate
   * @returns Corrected parameters
   */
  private validateToolParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
    // Apply registry defaults first
    const validatedParams = ToolRegistry.validateAndApplyDefaults(toolName, parameters);
    
    // Special validation for search tools
    if (ToolRegistry.isWebSearchTool(toolName)) {
      // Validate topic parameter - must be 'general' or 'news'
      if (validatedParams.topic && typeof validatedParams.topic === 'string') {
        const validTopics = ['general', 'news'];
        if (!validTopics.includes(validatedParams.topic)) {
          logger.warn(`${this.magiName} correcting invalid topic "${validatedParams.topic}" to "general" for ${toolName} tool`);
          validatedParams.topic = 'general'; // Default to 'general' for invalid topics
        }
      }
      
      logger.debug(`${this.magiName} validated search tool parameters for ${toolName}:`, validatedParams);
    }
    
    if (ToolRegistry.isWebExtractTool(toolName)) {
      logger.debug(`${this.magiName} validated extract tool parameters for ${toolName}:`, validatedParams);
    }
    
    return validatedParams;
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
      
      const hydrationPrompt = `
ORIGINAL INQUIRY:\n"${originalInquiry}"

ORIGINAL TOOL STEP JSON:\n
\`\`\`json
${JSON.stringify(originalStepJson, null, 2)}\n
\`\`\`

PREVIOUS STEP OUTPUT:\n
------------------------------------------------------
${previousOutput}\n
------------------------------------------------------

Your task:
- Consider the previous step output and the original inquiry.
- Identify any parameters in the original tool step to be populated or refined using information from the previous step output
- Provide the updated tool step JSON and maintain the same structure as the original
- Keep parameters unchanged if they don't need to be modified
- Ensure all required parameters are present and properly formatted

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
      } else {
        logger.debug(`${this.magiName} skipping hydration for step ${stepNumber} due to no previous output`);
      }
      
      // Validate and correct tool parameters before execution
      const validatedParameters = this.validateToolParameters(updatedStep.toolName!, updatedStep.toolParameters!);
      
      // Execute tool call with validated MCP parameters
      let toolResponse = await this.toolUser.executeWithTool(
        updatedStep.toolName!, 
        validatedParameters, 
        updatedStep.instruction
      );

      // Web pages can have a lot of noise that throw off the magi, so lets clean it
      if (updatedStep.toolName == 'tavily-extract'){
        const cleanExtractPrompt = getCleanExtractPrompt(originalInquiry, toolResponse);
        logger.debug(`😅😅😅😅😅😅Cleaned extract prompt:\n\n${cleanExtractPrompt}\n😅😅😅😅😅😅`);
        toolResponse = await this.conduitClient.contact(cleanExtractPrompt, '', this.model, { temperature: this.temperature })
        logger.debug(`😅😅😅😅😅😅Cleaned extract response:\n\n${toolResponse}\n😅😅😅😅😅😅`);
      }

      return toolResponse;
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
      
      return await this.conduitClient.contact(stepExecutionPrompt, '', this.model, { temperature: this.temperature });
    }
  }
}