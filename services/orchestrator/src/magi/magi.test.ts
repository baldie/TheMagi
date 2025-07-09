import { MagiName, PERSONAS_CONFIG, Magi } from './magi';

describe('Magi Configuration', () => {
  it('should have all three Magi personas configured', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Melchior]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Caspar]).toBeDefined();
  });

  it('should have correct temperature settings', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar].options.temperature).toBe(0.3);
    expect(PERSONAS_CONFIG[MagiName.Melchior].options.temperature).toBe(0.7);
    expect(PERSONAS_CONFIG[MagiName.Caspar].options.temperature).toBe(0.5);
  });
});

describe('Magi parsePlanSteps', () => {
  let magi: Magi;

  beforeEach(() => {
    magi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
  });

  it('should parse correctly formatted 3-step plan with tools', () => {
    const planResponse = `
Here is my analysis plan:

1. I will perform web search [TOOL][web_search] to gather relevant data [ARGS][topic research][data collection]
2. I will analyze the search results to identify key points
3. I will develop argument based on the data points found

I will execute these steps systematically.
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('I will perform web search to gather relevant data');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolArguments).toEqual({"arguments": ["topic research", "data collection"]});
    
    expect(result[1].description).toBe('I will analyze the search results to identify key points');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].toolName).toBeUndefined();
    expect(result[1].toolArguments).toBeUndefined();
    
    expect(result[2].description).toBe('I will develop argument based on the data points found');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].toolName).toBeUndefined();
    expect(result[2].toolArguments).toBeUndefined();
  });

  it('should parse plan with tool bypass', () => {
    const planResponse = `
My approach:

1) Research the topic thoroughly
2) Evaluate different perspectives
3) Synthesize findings into coherent response
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Research the topic thoroughly');
    expect(result[0].requiresTool).toBe(false);
    expect(result[1].description).toBe('Evaluate different perspectives');
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe('Synthesize findings into coherent response');
    expect(result[2].requiresTool).toBe(false);
  });

  it('should handle mixed formatting and incomplete tool info', () => {
    const planResponse = `
I will approach this systematically:

1. First, I'll gather relevant information [TOOL][web_search] [ARGS][relevant information]
2. Then I'll analyze the data carefully
Some explanation here...
3. Finally, I'll develop my response

This is my complete plan.
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe("First, I'll gather relevant information");
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe("web_search");
    expect(result[0].toolArguments).toEqual({"arguments": ["relevant information"]});
    expect(result[1].description).toBe("Then I'll analyze the data carefully");
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe("Finally, I'll develop my response");
    expect(result[2].requiresTool).toBe(false);
  });

  it('should return skipped steps when no numbered steps are found', () => {
    const planResponse = `
I think we should start by looking at the data.
Then we need to consider various options.
Finally, we should make a decision.
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Step 1: [Not provided - skipped]');
    expect(result[0].requiresTool).toBe(false);
    expect(result[0].skipped).toBe(true);
    expect(result[1].description).toBe('Step 2: [Not provided - skipped]');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    expect(result[2].description).toBe('Step 3: [Not provided - skipped]');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(true);
  });

  it('should return skipped steps when fewer than 3 steps are found', () => {
    const planResponse = `
1. Do some research
2. Make a conclusion
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
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

  it('should handle empty or whitespace-only response', () => {
    const planResponse = '   \n\n   ';

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Step 1: [Not provided - skipped]');
    expect(result[0].requiresTool).toBe(false);
    expect(result[0].skipped).toBe(true);
    expect(result[1].description).toBe('Step 2: [Not provided - skipped]');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    expect(result[2].description).toBe('Step 3: [Not provided - skipped]');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(true);
  });

  it('should ignore steps numbered beyond 3', () => {
    const planResponse = `
1. First step
2. Second step
3. Third step
4. Fourth step should be ignored
5. Fifth step should also be ignored
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('First step');
    expect(result[0].requiresTool).toBe(false);
    expect(result[1].description).toBe('Second step');
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].description).toBe('Third step');
    expect(result[2].requiresTool).toBe(false);
  });

  it('should handle invalid JSON in tool arguments gracefully', () => {
    const planResponse = `
1. Search for information [TOOL][web_search] [ARGS][invalid][malformed args]
2. Analyze without tools
3. Synthesize results
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Search for information');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].toolArguments).toEqual({"arguments": ["invalid", "malformed args"]});
  });

  it('should handle mixed case tool names and arguments', () => {
    const planResponse = `
1. Search for information [TOOL][WEB_SEARCH] [ARGS][test][10]
2. Analyze data
3. Final step [TOOL][data_analysis] [ARGS][results][summary]
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('WEB_SEARCH');
    expect(result[0].toolArguments).toEqual({"arguments": ["test", "10"]});
    expect(result[1].requiresTool).toBe(false);
    expect(result[2].requiresTool).toBe(true);
    expect(result[2].toolName).toBe('data_analysis');
    expect(result[2].toolArguments).toEqual({"arguments": ["results", "summary"]});
  });

  it('should handle [SKIP] format for steps that are not needed', () => {
    const planResponse = `
1. I will gather information [TOOL][web_search] [ARGS][topic info]
2. [SKIP] This analysis step is not needed for this simple query
3. I will synthesize the final response
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('I will gather information');
    expect(result[0].requiresTool).toBe(true);
    expect(result[0].toolName).toBe('web_search');
    expect(result[0].skipped).toBe(false);
    
    expect(result[1].description).toBe('This analysis step is not needed for this simple query');
    expect(result[1].requiresTool).toBe(false);
    expect(result[1].skipped).toBe(true);
    
    expect(result[2].description).toBe('I will synthesize the final response');
    expect(result[2].requiresTool).toBe(false);
    expect(result[2].skipped).toBe(false);
  });

  it('should handle mixed [SKIP] and regular steps', () => {
    const planResponse = `
1. [SKIP] No initial research needed
2. I will analyze the provided data [TOOL][analysis] [ARGS][data]
3. [SKIP] No tool verification required
    `.trim();

    const result = magi.parsePlanSteps(planResponse);
    
    expect(result).toHaveLength(3);
    expect(result[0].skipped).toBe(true);
    expect(result[0].description).toBe('No initial research needed');
    
    expect(result[1].skipped).toBe(false);
    expect(result[1].requiresTool).toBe(true);
    expect(result[1].toolName).toBe('analysis');
    
    expect(result[2].skipped).toBe(true);
    expect(result[2].description).toBe('No tool verification required');
  });
});