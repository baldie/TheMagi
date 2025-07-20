/**
 * Tests for Personal Data MCP Server
 */

import PersonalDataServer from './personal-data-server';
import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';

// Mock Vectra
jest.mock('vectra');

// Mock file system
jest.mock('fs/promises');

// Mock axios
jest.mock('axios');

describe('PersonalDataServer', () => {
  let server: PersonalDataServer;
  let mockVectraIndex: jest.Mocked<LocalIndex>;
  let mockAxios: jest.Mocked<typeof axios>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock axios
    mockAxios = axios as jest.Mocked<typeof axios>;
    mockAxios.post = jest.fn();

    // Mock LocalIndex
    mockVectraIndex = {
      isIndexCreated: jest.fn(),
      createIndex: jest.fn(),
      insertItem: jest.fn(),
      queryItems: jest.fn(),
      listItems: jest.fn(),
      deleteItem: jest.fn()
    } as any;

    (LocalIndex as jest.MockedClass<typeof LocalIndex>).mockImplementation(() => mockVectraIndex);

    // Mock fs.mkdir
    (fs.mkdir as jest.MockedFunction<typeof fs.mkdir>).mockResolvedValue(undefined);

    server = new PersonalDataServer();
  });

  describe('Constructor', () => {
    it('should create a server instance with correct configuration', () => {
      expect(LocalIndex).toHaveBeenCalledWith(
        expect.stringContaining('.magi-data/personal-data-index')
      );
    });
  });

  describe('Tool handling', () => {
    beforeEach(() => {
      // Setup default mocks for index operations
      mockVectraIndex.isIndexCreated.mockResolvedValue(true);
      mockVectraIndex.createIndex.mockResolvedValue(undefined);
      mockVectraIndex.insertItem.mockResolvedValue({} as any);
      mockVectraIndex.queryItems.mockResolvedValue([]);
      mockVectraIndex.listItems.mockResolvedValue([]);

      // Setup default mock for Ollama embeddings API
      mockAxios.post.mockResolvedValue({
        data: {
          embedding: new Array(768).fill(0.1) // Mock 768-dimensional vector
        }
      });
    });

    it('should handle store action correctly', async () => {
      const mockArgs = {
        action: 'store',
        content: 'Test user preference',
        category: 'preferences',
        user_context: 'Testing'
      };

      // Access the private method through reflection for testing
      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      const result = await handleMethod(mockArgs);

      expect(mockVectraIndex.insertItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          vector: expect.any(Array),
          metadata: expect.objectContaining({
            content: 'Test user preference',
            category: 'preferences',
            timestamp: expect.any(String),
            user_context: 'Testing'
          })
        })
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      
      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.data.stored_item.content).toBe('Test user preference');
      expect(responseData.categories).toContain('preferences');

      // Verify Ollama API was called for embeddings
      expect(mockAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        {
          model: 'nomic-embed-text',
          prompt: 'Test user preference'
        },
        expect.objectContaining({
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should handle retrieve action correctly', async () => {
      const mockItem = {
        id: 'test-id',
        vector: [0.1, 0.2, 0.3],
        norm: 1.0,
        metadata: {
          id: 'test-id',
          content: 'Test content',
          category: 'test-category',
          timestamp: new Date().toISOString()
        }
      };

      mockVectraIndex.listItems.mockResolvedValue([mockItem]);

      const mockArgs = {
        action: 'retrieve',
        categories: ['test-category'],
        user_context: 'Testing retrieval'
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      const result = await handleMethod(mockArgs);

      expect(mockVectraIndex.listItems).toHaveBeenCalled();

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.data.items).toHaveLength(1);
      expect(responseData.data.items[0].content).toBe('Test content');
      expect(responseData.categories).toEqual(['test-category']);
    });

    it('should handle search action correctly', async () => {
      const mockSearchResult = {
        item: {
          id: 'search-result-id',
          vector: [0.1, 0.2, 0.3],
          norm: 1.0,
          metadata: {
            id: 'search-result-id',
            content: 'Searchable content',
            category: 'search-category',
            timestamp: new Date().toISOString()
          }
        },
        score: 0.95
      };

      mockVectraIndex.queryItems.mockResolvedValue([mockSearchResult]);

      const mockArgs = {
        action: 'search',
        content: 'search query',
        limit: 5
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      const result = await handleMethod(mockArgs);

      expect(mockVectraIndex.queryItems).toHaveBeenCalledWith(
        expect.any(Array), // vector
        'search query', // query
        5 // limit
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.data.query).toBe('search query');
      expect(responseData.data.items).toHaveLength(1);
      expect(responseData.data.items[0].similarity_score).toBe(0.95);
    });

    it('should reject invalid actions', async () => {
      const mockArgs = {
        action: 'invalid-action',
        content: 'test'
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Invalid action: invalid-action')
        })
      );
    });

    it('should require content and category for store action', async () => {
      const mockArgs = {
        action: 'store'
        // Missing content and category
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Content and category are required')
        })
      );
    });

    it('should require categories for retrieve action', async () => {
      const mockArgs = {
        action: 'retrieve'
        // Missing categories
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Categories array is required')
        })
      );
    });

    it('should require query for search action', async () => {
      const mockArgs = {
        action: 'search'
        // Missing query/content
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Query is required for searching')
        })
      );
    });

    it('should handle embedding generation failures with retries', async () => {
      // Mock API failure for first 2 attempts, success on 3rd
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce({
          data: {
            embedding: new Array(768).fill(0.2)
          }
        });

      const mockArgs = {
        action: 'store',
        content: 'Test content with retry',
        category: 'test'
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      const result = await handleMethod(mockArgs);

      // Should eventually succeed after retries
      expect(result.content).toHaveLength(1);
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
      
      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.data.stored_item.content).toBe('Test content with retry');
    });

    it('should fail after max retries for embedding generation', async () => {
      // Mock API failure for all attempts
      mockAxios.post.mockRejectedValue(new Error('Persistent network error'));

      const mockArgs = {
        action: 'store',
        content: 'Test content that will fail',
        category: 'test'
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Failed to generate embeddings after 3 attempts')
        })
      );

      expect(mockAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should validate embedding dimensions', async () => {
      // Mock API response with wrong dimensions
      mockAxios.post.mockResolvedValue({
        data: {
          embedding: new Array(512).fill(0.1) // Wrong size - should be 768
        }
      });

      const mockArgs = {
        action: 'store',
        content: 'Test content with wrong dimensions',
        category: 'test'
      };

      const handleMethod = (server as any).handlePersonalDataTool.bind(server);
      
      await expect(handleMethod(mockArgs)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Expected 768 dimensions, got 512')
        })
      );
    });
  });

  describe('Vector generation', () => {
    it('should generate embeddings using Ollama API', async () => {
      const testEmbedding = new Array(768).fill(0.1);
      mockAxios.post.mockResolvedValue({
        data: { embedding: testEmbedding }
      });

      const generateVector = (server as any).generateVector.bind(server);
      const vector = await generateVector('test content');

      expect(vector).toHaveLength(768);
      expect(vector).toEqual(testEmbedding);
      expect(mockAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        {
          model: 'nomic-embed-text',
          prompt: 'test content'
        },
        expect.objectContaining({
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should generate different API calls for different content', async () => {
      mockAxios.post
        .mockResolvedValueOnce({ data: { embedding: new Array(768).fill(0.1) } })
        .mockResolvedValueOnce({ data: { embedding: new Array(768).fill(0.2) } });

      const generateVector = (server as any).generateVector.bind(server);
      await generateVector('first content');
      await generateVector('second content');

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockAxios.post).toHaveBeenNthCalledWith(1, 
        'http://localhost:11434/api/embeddings',
        { model: 'nomic-embed-text', prompt: 'first content' },
        expect.any(Object)
      );
      expect(mockAxios.post).toHaveBeenNthCalledWith(2, 
        'http://localhost:11434/api/embeddings',
        { model: 'nomic-embed-text', prompt: 'second content' },
        expect.any(Object)
      );
    });
  });

  describe('Index initialization', () => {
    it('should create index if it does not exist', async () => {
      mockVectraIndex.isIndexCreated.mockResolvedValue(false);
      
      const initMethod = (server as any).initializeIndex.bind(server);
      await initMethod();

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.magi-data'),
        { recursive: true }
      );
      expect(mockVectraIndex.createIndex).toHaveBeenCalledWith({
        version: 1,
        deleteIfExists: false,
        metadata_config: {
          indexed: ['category', 'timestamp']
        }
      });
    });

    it('should not create index if it already exists', async () => {
      mockVectraIndex.isIndexCreated.mockResolvedValue(true);
      
      const initMethod = (server as any).initializeIndex.bind(server);
      await initMethod();

      expect(mockVectraIndex.createIndex).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Index creation failed');
      mockVectraIndex.isIndexCreated.mockRejectedValue(error);
      
      const initMethod = (server as any).initializeIndex.bind(server);
      
      await expect(initMethod()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Failed to initialize vector index')
        })
      );
    });
  });
});