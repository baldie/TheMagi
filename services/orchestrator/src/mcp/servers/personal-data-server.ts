#!/usr/bin/env node

/**
 * Personal Data MCP Server using Vectra Vector Database
 * 
 * Provides storage and retrieval of user personal data using vector similarity search
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type {
  Tool,
  CallToolResult,
  TextContent} from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import type { MetadataTypes } from 'vectra';
import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { logger } from '../../logger';

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
  private readonly server: Server;
  private readonly vectorIndex: LocalIndex;
  private readonly indexPath: string;
  private readonly config: PersonalDataConfig;

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
      ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
      embeddingModel: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',
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
    return this.retryOperation(async () => {
      const response = await axios.post(
        `${this.config.ollamaUrl}/api/embeddings`,
        {
          model: this.config.embeddingModel,
          prompt: text
        },
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return this.validateEmbeddingResponse(response.data);
    }, 'generate embeddings');
  }

  /**
   * Validate embedding response format and dimensions
   */
  private validateEmbeddingResponse(data: any): number[] {
    const embeddingResponse = data as OllamaEmbeddingResponse;
    
    if (!embeddingResponse.embedding || !Array.isArray(embeddingResponse.embedding)) {
      throw new Error('Invalid embedding response format');
    }

    const embedding = embeddingResponse.embedding;
    
    if (embedding.length !== this.config.vectorDimensions) {
      throw new Error(
        `Expected ${this.config.vectorDimensions} dimensions, got ${embedding.length}`
      );
    }

    return embedding;
  }

  /**
   * Generic retry operation helper
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries = 3,
    retryDelay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to ${operationName} after ${maxRetries} attempts: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }

        console.warn(
          `${operationName} attempt ${attempt} failed, retrying in ${retryDelay}ms...`,
          error instanceof Error ? error.message : error
        );

        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    throw new McpError(ErrorCode.InternalError, `Unexpected error in ${operationName}`);
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
            description: 'Store or Retrieve data about the user using vector similarity search. IMPORTANT: You MUST store any personal data or preferences that the user has shared with you if you have not done so already.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['store', 'retrieve', 'search'],
                  description: 'Action to perform **REQUIRED**'
                },
                content: {
                  type: 'string',
                  description: 'Content to store or search for'
                },
                category: {
                  type: 'string',
                  description: 'Category of the data ("Health & Wellness", "Preferences", "Relationships", "Daily Routines", "Personal Facts", "Goals", etc)'
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
        case 'retrieve': {
          // absolutely make sure categories array is provided when retrieving
          const retrievalCategories: string [] = [];
          retrievalCategories.push(...(categories || []));
          retrievalCategories.push(category || '');
          return await this.retrieveData(retrievalCategories, user_context, limit);
        }
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

    const itemId = `pd_${Date.now()}_${randomBytes(6).toString('hex')}`;
    const vector = await this.generateVector(content);

    const metadata: PersonalDataItem = {
      id: itemId,
      content,
      category,
      timestamp: new Date().toISOString(),
      user_context: user_context ?? ''
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
      context: user_context ?? 'No context provided',
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

    const filteredItemsPromises = allItems
      .filter(item => typeof item.metadata.category === 'string' && categories.includes(item.metadata.category))
      .slice(0, limit)
      .map(async item => {
        // Handle both current PersonalDataItem format and any legacy formats
        const metadata = item.metadata as any;
        
        // The item.id should be the primary source for ID, with metadata.id as fallback
        const id = item.id || metadata.id || 'unknown';
        
        // Try multiple possible locations for content
        let content: string;
        if (item.metadataFile && typeof item.metadataFile === 'string') {
          // Content is stored in a separate metadata file
          try {
            const metadataFilePath = path.join(this.indexPath, item.metadataFile);
            const metadataFileContent = await fs.readFile(metadataFilePath, 'utf-8');
            const parsedMetadata = JSON.parse(metadataFileContent);
            content = parsedMetadata.content || '[Content not available in metadata file]';
          } catch (error) {
            logger.error(`Error reading metadata file ${item.metadataFile}:`, error);
            content = '[Error reading content from metadata file]';
          }
        } else if (metadata.content && typeof metadata.content === 'string') {
          content = metadata.content;
        } else if (metadata.text && typeof metadata.text === 'string') {
          // Legacy format check
          content = metadata.text;
        } else if (metadata.value && typeof metadata.value === 'string') {
          // Another possible legacy format
          content = metadata.value;
        } else {
          content = '[Content not available - please re-add this information]';
        }
        
        return {
          id,
          content,
          category: metadata.category || 'unknown',
          timestamp: metadata.timestamp || new Date().toISOString(),
          user_context: metadata.user_context || metadata.context || ''
        };
      });

    const finalItems = await Promise.all(filteredItemsPromises);
    const response = {
      data: {
        items: finalItems,
        total_found: finalItems.length
      },
      categories: categories,
      context: user_context ?? 'Category based retrieval',
      last_updated: finalItems.length > 0 ? String(finalItems[0].timestamp) : new Date().toISOString()
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
      const item = result.item;
      const metadata = item.metadata as any;
     
      // The item.id should be the primary source for ID, with metadata.id as fallback
      const id = item.id || metadata.id || 'unknown';
      
      // Try multiple possible locations for content
      let content: string;
      if (metadata.content && typeof metadata.content === 'string') {
        content = metadata.content;
      } else if (metadata.text && typeof metadata.text === 'string') {
        // Legacy format check
        content = metadata.text;
      } else if (metadata.value && typeof metadata.value === 'string') {
        // Another possible legacy format
        content = metadata.value;
      } else {
        content = '[Content not available - please re-add this information]';
      }
      
      return {
        id,
        content,
        category: metadata.category || 'unknown',
        timestamp: metadata.timestamp || new Date().toISOString(),
        user_context: metadata.user_context || metadata.context || '',
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