import { ShortTermMemory } from './short-term-memory';
import { MagiName } from '../types/magi-types';
import type { Magi } from './magi';

jest.mock('./magi');

describe('ShortTermMemory', () => {
  let memory: ShortTermMemory;
  let mockMagi: jest.Mocked<Magi>;

  beforeEach(() => {
    mockMagi = {
      name: 'TestMagi',
      contactSimple: jest.fn().mockResolvedValue('Test summary')
    } as any;
    memory = new ShortTermMemory(mockMagi);
  });

  describe('remember method', () => {
    it('should store a memory for a magi', () => {
      memory.remember('user', 'test message');
      
      const memories = memory.getMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0]).toEqual({
        speaker: 'user',
        message: 'test message'
      });
    });

    it('should store multiple memories for the same magi', () => {
      memory.remember('user', 'first message');
      memory.remember(MagiName.Caspar, 'second message');
      
      const memories = memory.getMemories();
      expect(memories).toHaveLength(2);
      expect(memories[0].message).toBe('first message');
      expect(memories[1].message).toBe('second message');
    });

  });

  describe('getMemories method', () => {
    it('should return empty array for new instance', () => {
      const memories = memory.getMemories();
      expect(memories).toEqual([]);
    });

    it('should return all memories for the instance', () => {
      memory.remember('user', 'message1');
      memory.remember(MagiName.Melchior, 'message2');
      
      const memories = memory.getMemories();
      expect(memories).toHaveLength(2);
    });

    it('should maintain separate memories for different instances', () => {
      const mockMagi2 = { contactWithoutPersonality: jest.fn() } as any;
      const casparMemory = new ShortTermMemory(mockMagi);
      const melchiorMemory = new ShortTermMemory(mockMagi2);
      
      casparMemory.remember('user', 'caspar message');
      melchiorMemory.remember('user', 'melchior message');
      
      const casparMemories = casparMemory.getMemories();
      const melchiorMemories = melchiorMemory.getMemories();
      
      expect(casparMemories).toHaveLength(1);
      expect(melchiorMemories).toHaveLength(1);
      expect(casparMemories[0].message).toBe('caspar message');
      expect(melchiorMemories[0].message).toBe('melchior message');
    });
  });

  describe('summarize method', () => {

    it('should return empty string when no memories exist', async () => {
      const summary = await memory.summarize(null);
      expect(summary).toBe('');
      expect(mockMagi.contactSimple).not.toHaveBeenCalled();
    });

    it('should call magi with proper parameters when memories exist', async () => {
      memory.remember('user', 'test message');
      
      const summary = await memory.summarize(null);
      
      expect(mockMagi.contactSimple).toHaveBeenCalledWith(
        expect.stringContaining('Provide an extractive summary'),
        expect.stringContaining('PERSONA')
      );
      expect(summary).toBe('Test summary');
    });

    it('should handle magi errors gracefully', async () => {
      memory.remember('user', 'test message');
      mockMagi.contactSimple = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      const summary = await memory.summarize(null);
      
      expect(summary).toContain('Error summarizing memories');
    });

    it('should format memories properly in the prompt', async () => {
      memory.remember('user', 'user message');
      memory.remember(MagiName.Melchior, 'magi message');
      
      await memory.summarize(null);
      
      const callArgs = mockMagi.contactSimple.mock.calls[0];
      const prompt = callArgs[0];
      
      expect(prompt).toContain('Speaker: user');
      expect(prompt).toContain('Message: user message');
      expect(prompt).toContain('Speaker: Melchior');
      expect(prompt).toContain('Message: magi message');
    });
  });
});