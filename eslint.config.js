// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { default as sonarjs } from 'eslint-plugin-sonarjs';

export default tseslint.config(
  // Apply to all files
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,

  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.js',
      '**/*.mjs',
      '!eslint.config.js',
      '**/.angular/**',
      '**/logs/**'
    ]
  },

  // TypeScript-specific configuration for services
  {
    files: ['services/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './services/orchestrator/tsconfig.json',
          './services/conduit/tsconfig.json'
        ]
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      // Current Rules from existing configs
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // Additional recommended rules
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/promise-function-async': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn'
      // Removed 'eqeqeq' and 'prefer-const' as SonarJS provides better equivalents
    }
  },

  // UI-specific configuration (simpler, without type-aware rules)
  {
    files: ['ui/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      // Basic rules that don't require type information
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
      // Removed 'eqeqeq' and 'prefer-const' as SonarJS provides better equivalents
      // Note: Removed type-aware rules for UI since no project config
    }
  }
);