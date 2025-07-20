#!/usr/bin/env node

/**
 * Personal Data MCP Server using Vectra Vector Database
 * 
 * Provides storage and retrieval of user personal data using vector similarity search
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { LocalIndex, MetadataTypes } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';

/**
 * Configuration for the Personal Data server
 */
interface PersonalDataConfig {
  ollamaUrl: string;
  embeddingModel: string;
  vectorDimensions: number;
}

/**
 * Ollama embeddings API response
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Personal data item stored in the vector database
 */
interface PersonalDataItem extends Record<string, MetadataTypes> {
  id: string;
  content: string;
  category: string;
  timestamp: string;
  user_context: string;
}

/**
 * Personal Data MCP Server class
 */
class PersonalDataServer {
  private server: Server;
  private vectorIndex: LocalIndex;
  private indexPath: string;
  private config: PersonalDataConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'personal-data-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Set up configuration
    this.config = {
      ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
      embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
      vectorDimensions: 768 // nomic-embed-text produces 768-dimensional vectors
    };

    // Set up vector index path
    this.indexPath = path.join(process.cwd(), '.magi-data', 'personal-data-index');
    this.vectorIndex = new LocalIndex(this.indexPath);

    this.setupToolHandlers();
  }

  /**
   * Initialize the vector index
   */
  private async initializeIndex(): Promise<void> {
    try {
      // Ensure the data directory exists
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

      if (!(await this.vectorIndex.isIndexCreated())) {
        await this.vectorIndex.createIndex({
          version: 1,
          deleteIfExists: false,
          metadata_config: {
            indexed: ['category', 'timestamp'] // Index category and timestamp for filtering
          }
        });
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize vector index: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate embeddings using Ollama's API
   */
  private async generateVector(text: string): Promise<number[]> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.config.ollamaUrl}/api/embeddings`,
          {
            model: this.config.embeddingModel,
            prompt: text
          },
          {
            timeout: 30000, // 30 second timeout
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        const embeddingResponse = response.data as OllamaEmbeddingResponse;
        
        if (!embeddingResponse.embedding || !Array.isArray(embeddingResponse.embedding)) {
          throw new Error('Invalid embedding response format');
        }

        const embedding = embeddingResponse.embedding;
        
        // Validate expected dimensions
        if (embedding.length !== this.config.vectorDimensions) {
          throw new Error(
            `Expected ${this.config.vectorDimensions} dimensions, got ${embedding.length}`
          );
        }

        return embedding;

      } catch (error) {
        if (attempt === maxRetries) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to generate embeddings after ${maxRetries} attempts: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }

        // Log the retry attempt
        console.warn(
          `Embedding generation attempt ${attempt} failed, retrying in ${retryDelay}ms...`,
          error instanceof Error ? error.message : error
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    // This should never be reached due to the throw in the loop, but TypeScript requires it
    throw new McpError(ErrorCode.InternalError, 'Unexpected error in embedding generation');
  }

  /**
   * Setup tool handlers
   */
  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'personal-data',
            description: 'Store and retrieve user personal data using vector similarity search',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['store', 'retrieve', 'search'],
                  description: 'Action to perform'
                },
                content: {
                  type: 'string',
                  description: 'Content to store or search for'
                },
                category: {
                  type: 'string',
                  description: 'Category of the data (e.g., preferences, behavior, context)'
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of categories to retrieve (for retrieve action)'
                },
                user_context: {
                  type: 'string',
                  description: 'Context for the data request'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  minimum: 1,
                  maximum: 50,
                  default: 10
                }
              },
              required: ['action']
            }
          }
        ] as Tool[]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name !== 'personal-data') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }

      return await this.handlePersonalDataTool(args);
    });
  }

  /**
   * Handle personal data tool calls
   */
  private async handlePersonalDataTool(args: any): Promise<CallToolResult> {
    try {
      await this.initializeIndex();

      const { action, content, category, categories, user_context, limit = 10 } = args;

      switch (action) {
        case 'store':
          return await this.storeData(content, category, user_context);
        case 'retrieve':
          return await this.retrieveData(categories, user_context, limit);
        case 'search':
          return await this.searchData(content, limit);
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid action: ${action}. Must be 'store', 'retrieve', or 'search'`
          );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Personal data operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Store personal data
   */
  private async storeData(content: string, category: string, user_context?: string): Promise<CallToolResult> {
    if (!content || !category) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Content and category are required for storing data'
      );
    }

    const itemId = `pd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const vector = await this.generateVector(content);

    const metadata: PersonalDataItem = {
      id: itemId,
      content,
      category,
      timestamp: new Date().toISOString(),
      user_context: user_context || ''
    };

    await this.vectorIndex.insertItem({
      id: itemId,
      vector,
      metadata
    });

    const response = {
      data: {
        stored_item: metadata,
        vector_length: vector.length
      },
      categories: [category],
      context: user_context || 'No context provided',
      last_updated: metadata.timestamp
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        } as TextContent
      ]
    };
  }

  /**
   * Retrieve data by categories
   */
  private async retrieveData(categories: string[], user_context?: string, limit: number = 10): Promise<CallToolResult> {
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Categories array is required for retrieving data'
      );
    }

    const allItems = await this.vectorIndex.listItems();
    
    const filteredItems = allItems
      .filter(item => typeof item.metadata.category === 'string' && categories.includes(item.metadata.category))
      .slice(0, limit)
      .map(item => item.metadata);

    const response = {
      data: {
        items: filteredItems,
        total_found: filteredItems.length
      },
      categories: categories,
      context: user_context || 'Category-based retrieval',
      last_updated: filteredItems.length > 0 ? String(filteredItems[0].timestamp) : new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        } as TextContent
      ]
    };
  }

  /**
   * Search data using vector similarity
   */
  private async searchData(query: string, limit: number = 10): Promise<CallToolResult> {
    if (!query) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Query is required for searching data'
      );
    }

    const queryVector = await this.generateVector(query);
    const results = await this.vectorIndex.queryItems(queryVector, query, limit);

    const items = results.map(result => {
      const metadata = result.item.metadata as PersonalDataItem;
      return {
        id: metadata.id,
        content: metadata.content,
        category: metadata.category,
        timestamp: metadata.timestamp,
        user_context: metadata.user_context || '',
        similarity_score: result.score
      };
    });

    const response = {
      data: {
        query,
        items,
        total_found: results.length
      },
      categories: [...new Set(items.map(item => String(item.category)).filter(cat => cat))],
      context: `Similarity search for: ${query}`,
      last_updated: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        } as TextContent
      ]
    };
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new PersonalDataServer();
  server.start().catch((error) => {
    console.error('Failed to start personal data server:', error);
    process.exit(1);
  });
}

export default PersonalDataServer;