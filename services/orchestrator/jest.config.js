const isCI = process.env.CI === 'true';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  modulePaths: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(test).ts'],
  // Skip long-running integration tests on CI runners
  testPathIgnorePatterns: isCI ? ['<rootDir>/src/testing/integration/'] : [],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'text-summary']
};