import { logger } from '../logger';
import { MagiName } from './magi';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Model } from '../config';

export const DEFAULT_PLAN_JSON = 
`    {
      "Step1": {
        "description": "respond with the answer to the simple question"
      },
      "Step2": {
        "description": "[SKIP]"
      },
      "Step3": {
        "description": "[SKIP]"
      }
    }`;

/**
 * Enhanced plan step with tool information
 */
export interface PlanStep {
  description: string;
  requiresTool: boolean;
  toolName?: string;
  toolArguments?: string[];
  skipped?: boolean;
}

/*
 This is the initial plan for all Magi personas.
 Once they get to step 3, this plan expand to include steps from the Magi's plan
*/
export const InitialPlan: PlanStep [] = [
  { description: 'Step1: Create response plan for inquiry', requiresTool: false, skipped: false },
  { description: 'Step2: Review plan', requiresTool: false, skipped: false },
  { description: 'Step3: Create custom plan based on review', requiresTool: false, skipped: false }
];

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
      return `- { "tool": { "name": "${t.name}", "description": "${t.description}", "args": "${parameterName || 'query'}" } }`;
    }).join('\n');
  }

  /**
   * Returns a fresh copy of the initial plan so each Magi has its own copy
   * @returns A new array with the initial plan steps
   */
  getInitialPlan(): PlanStep[] {
    return [
      { description: 'Step1: Create response plan for inquiry', requiresTool: false, skipped: false },
      { description: 'Step2: Review plan', requiresTool: false, skipped: false },
      { description: 'Step3: Create custom plan based on review', requiresTool: false, skipped: false }
    ];
  }

  /**
   * Update the personality prompt - called when the Magi personality is set
   */
  setPersonality(personalityPrompt: string): void {
    this.personalityPrompt = personalityPrompt;
  }

  private personalityPrompt: string = '';

  /**
   * Generate raw LLM response for creating a plan for the given inquiry.
   * @param inquiry - The inquiry to analyze.
   * @returns A promise that resolves to the raw LLM response.
   */
  async createResponsePlan(inquiry: string): Promise<string> {
    let prompt = `
    INSTRUCTIONS:
    Your task is to create a concise 3-step JSON plan of how you will address the inquiry.
    Make sure your 3 step JSON plan is concise and focused on the inquiry.
    Should you decide the inquiry warrants use of a tool, you may include that tool in step 1.
    The tool name must match the name of the one of the tools you have access to.
    You can provide one or more arguments to the tool in the "args" array.
    Here are the tools you have access to:
    ${this.toolsList}
    
    Below are examples of different inquiries and how your plan should look:
    
    INQUIRY: "Suggest a meal for dinner"`;

    // Each Magi will have different tools available to them, so we will tailor the example accordingly
    switch(this.magiName){
      case MagiName.Balthazar:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "description": "Search the web for dinner related option",
            "tool": {
              "name": "web-search",
              "args": [
                "dinner suggestions",
                "easy dinners to prepare"
              ]
            }
          },
          "Step2": {
            "description": "extract the most relevant meal suggestions."
          },
          "Step3": {
            "description": "summarize the best suggestions from the web and share with the other Magi for input"
          }
        }
       \`\`\``;
        break;

      case MagiName.Melchior:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "description": "scan personal data for food-related information",
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
            "description": "scan the results for food preferences, dietary restrictions, and food allergy info"
          },
          "Step3": {
            "description": "summarize relevant findings for the other Magi while minimizing sharing any personal user data"
          }
        }
        \`\`\``;
        break;

      case MagiName.Caspar:
        prompt += `
        \`\`\`json
        {
          "Step1": {
            "description": "access smart home devices to gather kitchen and food information",
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
            "description": "catalog the available kitchen appliances and food inventory"
          },
          "Step3": {
            "description": "summarize the available appliances and food inventory for the other Magi to consider"
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
    
    const planResponse = await this.conduitClient.contact(prompt, this.personalityPrompt, this.model, { temperature: this.temperature });
    
    return planResponse;
  }

  /**
   * Review the maybeJSON plan and format it properly
   * @param maybeJSON - The text that might be JSON
   * @returns A promise that resolves to an well formatted JSON string.
   */
  async reviewPlan(maybeJSON: string): Promise<string> {
    // Helper function to safely check if JSON is valid without using try-catch for control flow
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

    // Make it valid
    if (!isValidJSON(jsonString)) {
      logger.debug(`JSON:\n${jsonString}\nis invalid, using LLM to reformat it`);
      const ensureJSONPrompt = `
      Format the following text to ensure it is valid JSON.
      Do not change the content, just ensure it is valid JSON.
      Only respond with the JSON:
      ${maybeJSON}`;
      jsonString = await this.conduitClient.contact(ensureJSONPrompt, 'You are a JSON expert', this.model, { temperature: 1 });
    }
    logger.debug(`${jsonString}`);

    return jsonString;
  }

  /**
   * Parse the plan response into individual steps with tool information.
   * New format: JSON with Step1, Step2, Step3 keys
   * @param prompt - The original prompt used to generate the plan.
   * @param planJSON - The raw plan response from the AI.
   * @returns A promise that resolves to an array of parsed plan steps.
   */
  async parsePlanSteps(planJSON: string): Promise<PlanStep[]> {
    let steps: PlanStep[] = [];
    
    try {
      const planData = JSON.parse(planJSON);

      // Process each step
      for (let i = 1; i <= 3; i++) {
        const stepData = planData[`Step${i}`];
        
        if (!stepData) {
          steps.push({
            description: `Step ${i}: [Not provided - skipped]`,
            requiresTool: false,
            skipped: true
          });
          continue;
        }
        
        let description = stepData.description || '';
        let requiresTool = false;
        let toolName: string | undefined;
        let toolArguments: string[] | undefined;
        let skipped = false;
        
        // Check if step is marked as skipped
        if (description.includes('[SKIP]')) {
          skipped = true;
          description = description.replace(/\[SKIP\]\s*/, '').trim();
        }
        
        // Check if step 1 has tool configuration
        if (i === 1 && stepData.tool) {
          requiresTool = true;
          toolName = stepData.tool.name;
          if (stepData.tool.args && Array.isArray(stepData.tool.args)) {
            toolArguments = stepData.tool.args;
          }
        }
        
        steps.push({
          description,
          requiresTool,
          toolName,
          toolArguments,
          skipped
        });
      }
      
    } catch (error) {
      logger.warn('Failed to parse JSON plan response:', error);
      return [
        { description: 'Step1: [Not provided - skipped]', requiresTool: false, skipped: true },
      ];
    }
    
    return steps;
  }

  /**
   * Execute the analysis plan step by step.
   * @param steps - The plan steps to execute.
   * @param originalinquiry - The original inquiry inquiry.
   * @returns A promise that resolves to the cumulative output.
   */
  async executePlan(steps: PlanStep[], originalinquiry: string): Promise<string> {
    let cumulativeOutput = '';
    let rawPlanResponse = '';
    let formattedJSON = '';
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;
      logger.debug(`${this.magiName} performing ${stepNumber}`);
      try {
        // Check if this step should be skipped
        if (step.skipped) {
          logger.debug(`${this.magiName} skipping step ${stepNumber}`);
          cumulativeOutput += `\n\nStep ${stepNumber} Result:\n[Step skipped - not required for this analysis]`;
        } else {
          let stepResult = '';
          
          // Handle special initial plan steps
          if (stepNumber === 1 && step.description.includes('Create response plan')) {
            // Step 1: Create response plan
            stepResult = await this.createResponsePlan(originalinquiry);
            rawPlanResponse = stepResult;
          } else if (stepNumber === 2 && step.description.includes('Review plan')) {
            // Step 2: Format JSON
            stepResult = await this.reviewPlan(rawPlanResponse);
            formattedJSON = stepResult;
          } else if (stepNumber === 3 && step.description.includes('Create custom plan')) {
            // Step 3: Parse plan steps and expand current plan
            const parsedSteps = await this.parsePlanSteps(formattedJSON);
            stepResult = `Parsed ${parsedSteps.length} plan steps`;
            
            // Append non-skipped steps to the current plan
            const nonSkippedSteps = parsedSteps.filter(s => !s.skipped);
            if (nonSkippedSteps.length > 0) {
              steps.push(...nonSkippedSteps);
              logger.debug(`${this.magiName} expanded plan with ${nonSkippedSteps.length} additional steps`);
            }
          } else {
            // Regular step execution
            stepResult = await this.executeStep(step, stepNumber, cumulativeOutput, originalinquiry);
          }
          
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
   * @param originalinquiry - The original inquiry inquiry.
   * @returns A promise that resolves to the step result.
   */
  private async executeStep(
    step: PlanStep, 
    stepNumber: number, 
    previousOutput: string, 
    originalinquiry: string
  ): Promise<string> {
    // Check if this step requires tool usage
    if (step.requiresTool && step.toolName && step.toolArguments) {
      // Check if we have multiple arguments that require multiple tool calls
      if (step.toolArguments.length > 1) {
        const results: string[] = [];
        
        // Execute tool call for each argument
        for (const argument of step.toolArguments) {
          const toolResult = await this.toolUser.executeWithTool(
            step.toolName, 
            { query: argument }, 
            step.description
          );
          results.push(`Result for "${argument}": ${toolResult}`);
        }
        
        return results.join('\n\n');
      } else {
        // Single tool call with first argument
        const toolResult = await this.toolUser.executeWithTool(
          step.toolName, 
          { query: step.toolArguments[0] }, 
          step.description
        );
        return toolResult;
      }
    } else {
      // Execute with simple reasoning (bypass mechanism)
      const reasoningPrompt = `${this.magiName}, you are executing step ${stepNumber} of your plan:\n"${step.description}"
      
      Original inquiry:\n"${originalinquiry}"
      Relevant information from previous steps:\n${previousOutput || 'None'}
      
      Please complete this step and remember to be concise.`;
      
      return await this.conduitClient.contact(reasoningPrompt, this.personalityPrompt, this.model, { temperature: this.temperature });
    }
  }

  /**
   * Synthesize the final response from analysis results.
   * @param analysisResult - The cumulative analysis results.
   * @param originalinquiry - The original inquiry inquiry.
   * @returns A promise that resolves to the synthesized response.
   */
  async synthesizeResponse(analysisResult: string, originalinquiry: string): Promise<string> {
    const synthesisPrompt = `${this.magiName}, you have completed your independent analysis of the inquiry: "${originalinquiry}"
    
    Your analysis results:
    ${analysisResult}
    
    Please synthesize a concise, well-reasoned response that directly addresses the original inquiry. 
    Focus on the results from your plan and present them clearly. Be concise yet thorough.
    If it is a simple answer, provide it directly.`;
    
    return await this.conduitClient.contact(synthesisPrompt, this.personalityPrompt, this.model, { temperature: this.temperature });
  }
}