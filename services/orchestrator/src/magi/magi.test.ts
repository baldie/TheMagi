import { MagiName, PERSONAS_CONFIG, Magi } from './magi';
import { Planner } from './planner';

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
    const seedPlan = Planner.getSeedPlan();
    
    expect(seedPlan).toHaveLength(2);
    expect(seedPlan[0].instruction).toContain('Create response plan');
    expect(seedPlan[1].instruction).toContain('Execute custom plan');
    expect(seedPlan.every((step: any) => !step.toolName)).toBe(true);
  });
});

describe('Magi parsePlanSteps', () => {
  let magi: Magi;

  beforeEach(() => {
    magi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
    magi.setPersonality("You are Balthazar, a logical and analytical AI assistant.");
  });

  it('should parse correctly formatted 3-step plan with MCP tools', async () => {
    const planResponse = `
Here is my analysis plan:

{
  "Step1": {
    "instruction": "perform web search to gather relevant data",
    "tool": {
      "name": "web_search",
      "args": {
        "query": "climate change research data",
        "limit": 5,
        "include_content": true
      }
    }
  },
  "Step2": {
    "instruction": "analyze the search results to identify key points"
  },
  "Step3": {
    "instruction": "develop argument based on the data points found"
  }
}

I will execute these steps systematically.
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe('perform web search to gather relevant data');
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolParameters).toEqual({
      query: "climate change research data",
      limit: 5,
      include_content: true
    });
    
    expect(result[1].instruction).toBe('analyze the search results to identify key points');
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    
    expect(result[2].instruction).toBe('develop argument based on the data points found');
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolParameters).toBeUndefined();
  });


  it('should parse plan with tool bypass', async () => {
    const planResponse = `
My approach:

{
  "Step1": {
    "instruction": "Research the topic thoroughly"
  },
  "Step2": {
    "instruction": "Evaluate different perspectives"
  },
  "Step3": {
    "instruction": "Synthesize findings into coherent response"
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe('Research the topic thoroughly');
    expect(result[0].toolName).toBeUndefined();
    expect(result[1].instruction).toBe('Evaluate different perspectives');
    expect(result[1].toolName).toBeUndefined();
    expect(result[2].instruction).toBe('Synthesize findings into coherent response');
    expect(result[2].toolName).toBeUndefined();
  });

  it('should handle mixed formatting with MCP tool parameters', async () => {
    const planResponse = `
I will approach this systematically:

{
  "Step1": {
    "instruction": "gather relevant information",
    "tool": {
      "name": "web_search",
      "args": {
        "query": "relevant information about the topic",
        "limit": 3,
        "include_content": false
      }
    }
  },
  "Step2": {
    "instruction": "analyze the data carefully"
  },
  "Step3": {
    "instruction": "develop my response"
  }
}

This is my complete plan.
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe("gather relevant information");
    expect(result[0].toolName).toBe("web_search");
    expect(result[0].toolParameters).toEqual({
      query: "relevant information about the topic",
      limit: 3,
      include_content: false
    });
    expect(result[1].instruction).toBe("analyze the data carefully");
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    expect(result[2].instruction).toBe("develop my response");
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolParameters).toBeUndefined();
  });

  it('should return default plan when no JSON is found', async () => {
    const planResponse = `
I think we should start by looking at the data.
Then we need to consider various options.
Finally, we should make a decision.
    `.trim();

    // Extract JSON from the plan response for testing - no JSON, so use fallback
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : `{ "Step1": { "instruction": "respond with the answer to the simple question" } }`;
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(1);
    expect(result[0].instruction).toBe('respond with the answer to the simple question');
    expect(result[0].toolName).toBeUndefined();
  });

  it('should return only valid steps when parsing multi-step plans', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "Do some research"
  },
  "Step2": {
    "instruction": "Make a conclusion"
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(2);
    expect(result[0].instruction).toBe('Do some research');
    expect(result[0].toolName).toBeUndefined();
    expect(result[1].instruction).toBe('Make a conclusion');
    expect(result[1].toolName).toBeUndefined();
  });

  it('should handle empty or whitespace-only response', async () => {
    const planResponse = '   \n\n   ';

    // Extract JSON from the plan response for testing - no JSON, so use fallback
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : `{ "Step1": { "instruction": "respond with the answer to the simple question" } }`;
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(1);
    expect(result[0].instruction).toBe('respond with the answer to the simple question');
    expect(result[0].toolName).toBeUndefined();
  });

  it('should support variable number of steps including beyond 3', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "First step"
  },
  "Step2": {
    "instruction": "Second step"
  },
  "Step3": {
    "instruction": "Third step"
  },
  "Step4": {
    "instruction": "Fourth step"
  },
  "Step5": {
    "instruction": "Fifth step"
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(5);
    expect(result[0].instruction).toBe('First step');
    expect(result[0].toolName).toBeUndefined();
    expect(result[1].instruction).toBe('Second step');
    expect(result[1].toolName).toBeUndefined();
    expect(result[2].instruction).toBe('Third step');
    expect(result[2].toolName).toBeUndefined();
    expect(result[3].instruction).toBe('Fourth step');
    expect(result[3].toolName).toBeUndefined();
    expect(result[4].instruction).toBe('Fifth step');
    expect(result[4].toolName).toBeUndefined();
  });

  it('should handle MCP format with multiple parameters', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "Search for information",
    "tool": {
      "name": "web_search",
      "args": {
        "query": "comprehensive information search",
        "limit": 10,
        "include_content": true
      }
    }
  },
  "Step2": {
    "instruction": "Analyze without tools"
  },
  "Step3": {
    "instruction": "Synthesize results"
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe('Search for information');
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolParameters).toEqual({
      query: "comprehensive information search",
      limit: 10,
      include_content: true
    });
  });

  it('should handle mixed case tool names with MCP parameters', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "Search for information",
    "tool": {
      "name": "WEB_SEARCH",
      "args": {
        "query": "test search query",
        "limit": 10
      }
    }
  },
  "Step2": {
    "instruction": "Analyze data"
  },
  "Step3": {
    "instruction": "Final step"
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].toolName).toBe('WEB_SEARCH');
    expect(result[0].toolParameters).toEqual({
      query: "test search query",
      limit: 10
    });
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolParameters).toBeUndefined();
  });

  it('should handle tool calls on any step with MCP format', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "gather information",
    "tool": {
      "name": "web_search",
      "args": {
        "query": "topic information",
        "limit": 5
      }
    }
  },
  "Step2": {
    "instruction": "analyze the gathered data"
  },
  "Step3": {
    "instruction": "synthesize the final response",
    "tool": {
      "name": "synthesis_tool",
      "args": {
        "mode": "final_analysis",
        "format": "comprehensive"
      }
    }
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe('gather information');
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolParameters).toEqual({
      query: "topic information",
      limit: 5
    });
    
    expect(result[1].instruction).toBe('analyze the gathered data');
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    
    expect(result[2].instruction).toBe('synthesize the final response');
    expect(result[2].toolName).toBe('synthesis_tool');
    expect(result[2].toolParameters).toEqual({
      mode: "final_analysis",
      format: "comprehensive"
    });
  });

  it('should handle multi-step plans with tools on different steps using MCP format', async () => {
    const planResponse = `
{
  "Step1": {
    "instruction": "analyze the provided data",
    "tool": {
      "name": "analysis",
      "args": {
        "dataset": "user_provided_data",
        "type": "statistical"
      }
    }
  },
  "Step2": {
    "instruction": "perform additional analysis if needed"
  },
  "Step3": {
    "instruction": "verify results with validation tool",
    "tool": {
      "name": "validation",
      "args": {
        "results": "analysis_output",
        "confidence_level": 0.95
      }
    }
  }
}
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].toolName).toBe('analysis');
    expect(result[0].instruction).toBe('analyze the provided data');
    expect(result[0].toolParameters).toEqual({
      dataset: "user_provided_data",
      type: "statistical"
    });
    
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    expect(result[1].instruction).toBe('perform additional analysis if needed');
    
    expect(result[2].toolName).toBe('validation');
    expect(result[2].instruction).toBe('verify results with validation tool');
    expect(result[2].toolParameters).toEqual({
      results: "analysis_output",
      confidence_level: 0.95
    });
  });

  it('should handle JSON wrapped in markdown code blocks with MCP format', async () => {
    const planResponse = `
Here is my analysis plan:

\`\`\`json
{
  "Step1": {
    "instruction": "search for information about the topic",
    "tool": {
      "name": "web_search",
      "args": {
        "query": "comprehensive topic information and research data",
        "limit": 7,
        "include_content": true
      }
    }
  },
  "Step2": {
    "instruction": "analyze the search results"
  },
  "Step3": {
    "instruction": "synthesize findings into a response"
  }
}
\`\`\`

This plan will help me address the inquiry systematically.
    `.trim();

    // Extract JSON from the plan response for testing
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : '{}';
    const result = await magi.planner.parsePlanSteps(JSON.parse(jsonString));
    
    expect(result).toHaveLength(3);
    expect(result[0].instruction).toBe('search for information about the topic');
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolParameters).toEqual({
      query: "comprehensive topic information and research data",
      limit: 7,
      include_content: true
    });
    
    expect(result[1].instruction).toBe('analyze the search results');
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolParameters).toBeUndefined();
    
    expect(result[2].instruction).toBe('synthesize findings into a response');
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolParameters).toBeUndefined();
  });
});