import 'jest-preset-angular/setup-jest';
import { jest } from '@jest/globals';

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