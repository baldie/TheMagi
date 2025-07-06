/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@environments/(.*)$': '<rootDir>/src/environments/$1'
  },
  transform: {
    '^.+\\.(ts|js|mjs|html|svg)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        useESM: true
      }
    ]
  },
  transformIgnorePatterns: [
    'node_modules/(?!@angular|@ngrx|rxjs)'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/'
  ],
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  moduleDirectories: ['node_modules', '<rootDir>']
}; 