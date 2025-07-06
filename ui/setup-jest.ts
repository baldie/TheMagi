import 'jest-preset-angular/setup-jest';
import '@jest/globals';
import { jest } from '@jest/globals';

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

// Set up the mocks
jest.spyOn(window, 'AudioContext').mockImplementation(() => mockAudioContext as any);
(window as any).webkitAudioContext = window.AudioContext;

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    display: 'none',
    appearance: ['-webkit-appearance'],
    getPropertyValue: () => ''
  })
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