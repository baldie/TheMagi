import { MagiName, PERSONAS_CONFIG, Magi } from './magi';

describe('Magi Configuration', () => {
  it('should have all three Magi personas configured', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Melchior]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Caspar]).toBeDefined();
  });

  it('should have correct temperature settings', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar].options.temperature).toBe(0.4);
    expect(PERSONAS_CONFIG[MagiName.Melchior].options.temperature).toBe(0.6);
    expect(PERSONAS_CONFIG[MagiName.Caspar].options.temperature).toBe(0.5);
  });

  it('should have initial plan configured', () => {
    const { InitialPlan } = require('./planner');
    
    expect(InitialPlan).toHaveLength(3);
    expect(InitialPlan[0].description).toContain('Create response plan');
    expect(InitialPlan[1].description).toContain('Review plan');
    expect(InitialPlan[2].description).toContain('Create custom plan');
    expect(InitialPlan.every((step: any) => !step.skipped)).toBe(true);
  });
});

describe('Magi parsePlanSteps', () => {
  let magi: Magi;

  beforeEach(() => {
    magi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
  });

  it('should parse correctly formatted 3-step plan with tools', async () => {
    const planResponse = `
Here is my analysis plan:

{
  "Step1": {
    "description": "perform web search to gather relevant data",
    "tool": {
      "name": "web_search",
      "args": ["topic research", "data collection"]
    }
  },
  "Step2": {
    "description": "analyze the search results to identify key points"
  },
  "Step3": {
    "description": "develop argument based on the data points found"
  }
}

I will execute these steps systematically.
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('perform web search to gather relevant data');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolArguments).toEqual(["topic research", "data collection"]);
    
    expect(result[1].description).toBe('analyze the search results to identify key points');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolArguments).toBeUndefined();
    
    expect(result[2].description).toBe('develop argument based on the data points found');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolArguments).toBeUndefined();
  });

  it('should parse plan with tool bypass', async () => {
    const planResponse = `
My approach:

{
  "Step1": {
    "description": "Research the topic thoroughly"
  },
  "Step2": {
    "description": "Evaluate different perspectives"
  },
  "Step3": {
    "description": "Synthesize findings into coherent response"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Research the topic thoroughly');
    expect(result[0].requiresTool).toBe(false);
    expect(result[1].description).toBe('Evaluate different perspectives');
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe('Synthesize findings into coherent response');
    expect(result[2].requiresTool).toBe(false);
  });

  it('should handle mixed formatting and incomplete tool info', async () => {
    const planResponse = `
I will approach this systematically:

{
  "Step1": {
    "description": "gather relevant information",
    "tool": {
      "name": "web_search",
      "args": ["relevant information"]
    }
  },
  "Step2": {
    "description": "analyze the data carefully"
  },
  "Step3": {
    "description": "develop my response"
  }
}

This is my complete plan.
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe("gather relevant information");
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe("web_search");
    expect(result[0].toolArguments).toEqual(["relevant information"]);
    expect(result[1].description).toBe("analyze the data carefully");
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe("develop my response");
    expect(result[2].requiresTool).toBe(false);
  });

  it('should return default plan when no JSON is found', async () => {
    const planResponse = `
I think we should start by looking at the data.
Then we need to consider various options.
Finally, we should make a decision.
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('respond with the answer to the simple question');
    expect(result[0].requiresTool).toBe(false);
    expect(result[0].skipped).toBe(false);
    expect(result[1].description).toBe('');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    expect(result[2].description).toBe('');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(true);
  });

  it('should return skipped steps when fewer than 3 steps are found', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "Do some research"
  },
  "Step2": {
    "description": "Make a conclusion"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Do some research');
    expect(result[0].requiresTool).toBe(false);
    expect(result[0].skipped).toBe(false);
    expect(result[1].description).toBe('Make a conclusion');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(false);
    expect(result[2].description).toBe('Step 3: [Not provided - skipped]');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(true);
  });

  it('should handle empty or whitespace-only response', async () => {
    const planResponse = '   \n\n   ';

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('respond with the answer to the simple question');
    expect(result[0].requiresTool).toBe(false);
    expect(result[0].skipped).toBe(false);
    expect(result[1].description).toBe('');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    expect(result[2].description).toBe('');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(true);
  });

  it('should ignore steps numbered beyond 3', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "First step"
  },
  "Step2": {
    "description": "Second step"
  },
  "Step3": {
    "description": "Third step"
  },
  "Step4": {
    "description": "Fourth step should be ignored"
  },
  "Step5": {
    "description": "Fifth step should also be ignored"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('First step');
    expect(result[0].requiresTool).toBe(false);
    expect(result[1].description).toBe('Second step');
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe('Third step');
    expect(result[2].requiresTool).toBe(false);
  });

  it('should handle invalid JSON gracefully', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "Search for information",
    "tool": {
      "name": "web_search",
      "args": ["invalid", "malformed args"]
    }
  },
  "Step2": {
    "description": "Analyze without tools"
  },
  "Step3": {
    "description": "Synthesize results"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Search for information');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolArguments).toEqual(["invalid", "malformed args"]);
  });

  it('should handle mixed case tool names and arguments', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "Search for information",
    "tool": {
      "name": "WEB_SEARCH",
      "args": ["test", "10"]
    }
  },
  "Step2": {
    "description": "Analyze data"
  },
  "Step3": {
    "description": "Final step"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('WEB_SEARCH');
    expect(result[0].toolArguments).toEqual(["test", "10"]);
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].requiresTool).toBe(false);
  });

  it('should handle [SKIP] format for steps that are not needed', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "gather information",
    "tool": {
      "name": "web_search",
      "args": ["topic info"]
    }
  },
  "Step2": {
    "description": "[SKIP] This analysis step is not needed for this simple query"
  },
  "Step3": {
    "description": "synthesize the final response"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('gather information');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].skipped).toBe(false);
    
    expect(result[1].description).toBe('This analysis step is not needed for this simple query');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    
    expect(result[2].description).toBe('synthesize the final response');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(false);
  });

  it('should handle mixed [SKIP] and regular steps', async () => {
    const planResponse = `
{
  "Step1": {
    "description": "analyze the provided data",
    "tool": {
      "name": "analysis",
      "args": ["data"]
    }
  },
  "Step2": {
    "description": "[SKIP] No additional analysis needed"
  },
  "Step3": {
    "description": "[SKIP] No tool verification required"
  }
}
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].skipped).toBe(false);
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('analysis');
    expect(result[0].description).toBe('analyze the provided data');
    
    expect(result[1].skipped).toBe(true);
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].description).toBe('No additional analysis needed');
    
    expect(result[2].skipped).toBe(true);
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].description).toBe('No tool verification required');
  });

  it('should handle JSON wrapped in markdown code blocks', async () => {
    const planResponse = `
Here is my analysis plan:

\`\`\`json
{
  "Step1": {
    "description": "search for information about the topic",
    "tool": {
      "name": "web-search",
      "args": ["topic information", "research data"]
    }
  },
  "Step2": {
    "description": "analyze the search results"
  },
  "Step3": {
    "description": "synthesize findings into a response"
  }
}
\`\`\`

This plan will help me address the inquiry systematically.
    `.trim();

    const formattedJSON = await magi.planner.reviewPlan(planResponse);
    const result = await magi.parsePlanSteps(formattedJSON);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('search for information about the topic');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web-search');
    expect(result[0].toolArguments).toEqual(["topic information", "research data"]);
    
    expect(result[1].description).toBe('analyze the search results');
    expect(result[1].requiresTool).toBe(false);
    
    expect(result[2].description).toBe('synthesize findings into a response');
    expect(result[2].requiresTool).toBe(false);
  });
});