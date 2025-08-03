/**
 * Tool-specific response type definitions for MCP tools
 */

/**
 * Response from web search tools (Tavily search API)
 */
export interface WebSearchResponse {
  query: string;
  answer?: string;
  images: string[];
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    raw_content?: string;
    favicon?: string;
  }>;
  auto_parameters?: Record<string, any>;
  response_time: number;
}

/**
 * Response from web content extraction tools (Tavily extract API)
 */
export interface WebExtractResponse {
  results: Array<{
    url: string;
    raw_content: string;
    images?: string[];
    favicon?: string;
  }>;
  failed_results: Array<{
    url: string;
    error: string;
  }>;
  response_time: number;
}

/**
 * Response from smart home device tools
 */
export interface SmartHomeResponse {
  devices: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    data?: Record<string, any>;
  }>;
  timestamp: string;
}

/**
 * Response from personal data tools
 */
export interface PersonalDataResponse {
  data: Record<string, any>;
  categories: string[];
  context: string;
  last_updated?: string;
}

/**
 * Generic text-only response for simple tools
 */
export interface TextResponse {
  text: string;
  metadata?: Record<string, any>;
}

/**
 * Mapping of tool names to their specific response types
 * This is auto-generated from the tool registry
 */
export type ToolResponseMap = {
  // Web search tools
  'search': WebSearchResponse;
  'searchContext': WebSearchResponse;
  'search-web': WebSearchResponse;
  
  // Web extract tools
  'extract': WebExtractResponse;
  'crawl_url': WebExtractResponse;
  'read-page': WebExtractResponse;
  
  // Smart home tools
  'smart-home-devices': SmartHomeResponse;
  
  // Personal data tools
  'personal-data': PersonalDataResponse;
};

/**
 * Union type of all possible tool response types
 */
export type AnyToolResponse = WebSearchResponse | WebExtractResponse | SmartHomeResponse | PersonalDataResponse | TextResponse;

/**
 * Generic tool execution response wrapper with type safety
 */
export interface ToolExecutionResponse<T extends keyof ToolResponseMap = keyof ToolResponseMap> {
  data: ToolResponseMap[T];
  isError?: boolean;
  _meta?: Record<string, any>;
}

/**
 * For tools not in the map, fallback to text response
 */
export interface GenericToolExecutionResponse {
  data: TextResponse;
  isError?: boolean;
  _meta?: Record<string, any>;
}

/**
 * Helper type to get the response type for a specific tool
 */
export type GetToolResponse<T extends string> = T extends keyof ToolResponseMap 
  ? ToolExecutionResponse<T>
  : GenericToolExecutionResponse;