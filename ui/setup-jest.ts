import 'jest-preset-angular/setup-jest';
import '@jest/globals';
import { jest, beforeAll } from '@jest/globals';

// Mock AudioContext
class MockAudioContext {
  createGain() {
    return {
      connect: jest.fn(),
      gain: { value: 1 }
    };
  }
  createOscillator() {
    return {
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      frequency: { value: 440 }
    };
  }
}

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    display: 'none',
    appearance: ['-webkit-appearance'],
    getPropertyValue: () => ''
  })
});

// Mock AudioContext
Object.defineProperty(window, 'AudioContext', {
  value: MockAudioContext
});

Object.defineProperty(window, 'webkitAudioContext', {
  value: MockAudioContext
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock window.AudioContext for tests
const mockAudioContext = {
  createMediaStreamSource: jest.fn().mockReturnValue({ connect: jest.fn() }),
  createScriptProcessor: jest.fn().mockReturnValue({ connect: jest.fn() }),
  createBufferSource: jest.fn().mockReturnValue({
    connect: jest.fn(),
    start: jest.fn(),
    onended: jest.fn()
  }),
  decodeAudioData: jest.fn().mockResolvedValue({
    duration: 0,
    length: 0,
    numberOfChannels: 1,
    sampleRate: 44100
  }),
  destination: {}
};

// Set up the mocks before any tests run
beforeAll(() => {
  // Delete existing properties
  delete (window as any).AudioContext;
  delete (window as any).webkitAudioContext;
  
  // Add our mocked versions
  Object.defineProperty(window, 'AudioContext', {
    value: jest.fn(() => mockAudioContext),
    writable: true,
    configurable: true
  });
  
  Object.defineProperty(window, 'webkitAudioContext', {
    value: window.AudioContext,
    writable: true,
    configurable: true
  });
}); 