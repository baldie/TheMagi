import { ShortTermMemory } from './short-term-memory';
import { MagiName } from '../types/magi-types';
import { Magi } from './magi';

jest.mock('./magi');

describe('ShortTermMemory', () => {
  let memory: ShortTermMemory;
  let mockMagi: jest.Mocked<Magi>;

  beforeEach(() => {
    mockMagi = {
      contactSimple: jest.fn().mockResolvedValue('Test summary')
    } as any;
    memory = new ShortTermMemory(mockMagi);
  });

  describe('remember method', () => {
    it('should store a memory for a magi', () => {
      memory.remember('user', 'test scratchpad', 'test message');
      
      const memories = memory.getMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0]).toEqual({
        scratchpad: 'test scratchpad',
        speaker: 'user',
        message: 'test message'
      });
    });

    it('should store multiple memories for the same magi', () => {
      memory.remember('user', 'first scratchpad', 'first message');
      memory.remember(MagiName.Caspar, 'second scratchpad', 'second message');
      
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
      memory.remember('user', 'scratchpad1', 'message1');
      memory.remember(MagiName.Melchior, 'scratchpad2', 'message2');
      
      const memories = memory.getMemories();
      expect(memories).toHaveLength(2);
    });

    it('should maintain separate memories for different instances', () => {
      const mockMagi2 = { contactWithoutPersonality: jest.fn() } as any;
      const casparMemory = new ShortTermMemory(mockMagi);
      const melchiorMemory = new ShortTermMemory(mockMagi2);
      
      casparMemory.remember('user', 'caspar scratchpad', 'caspar message');
      melchiorMemory.remember('user', 'melchior scratchpad', 'melchior message');
      
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
      const summary = await memory.summarize();
      expect(summary).toBe('');
      expect(mockMagi.contactSimple).not.toHaveBeenCalled();
    });

    it('should call magi with proper parameters when memories exist', async () => {
      memory.remember('user', 'test scratchpad', 'test message');
      
      const summary = await memory.summarize();
      
      expect(mockMagi.contactSimple).toHaveBeenCalledWith(
        expect.stringContaining('Please provide an extractive summary'),
        expect.stringContaining('PERSONA')
      );
      expect(summary).toBe('Test summary');
    });

    it('should handle magi errors gracefully', async () => {
      memory.remember('user', 'test scratchpad', 'test message');
      mockMagi.contactSimple = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      const summary = await memory.summarize();
      
      expect(summary).toContain('Error summarizing memories');
    });

    it('should format memories properly in the prompt', async () => {
      memory.remember('user', 'user scratchpad', 'user message');
      memory.remember(MagiName.Melchior, 'magi scratchpad', 'magi message');
      
      await memory.summarize();
      
      const callArgs = mockMagi.contactSimple.mock.calls[0];
      const prompt = callArgs[0];
      
      expect(prompt).toContain('Memory 1:');
      expect(prompt).toContain('Speaker: user');
      expect(prompt).toContain('Scratchpad: user scratchpad');
      expect(prompt).toContain('Message: user message');
      expect(prompt).toContain('Memory 2:');
      expect(prompt).toContain('Speaker: Melchior');
      expect(prompt).toContain('Scratchpad: magi scratchpad');
      expect(prompt).toContain('Message: magi message');
    });
  });
});