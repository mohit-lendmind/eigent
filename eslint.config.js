import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Shared React configuration
const reactConfig = {
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
    globals: {
      ...globals.browser,
      ...globals.node,
      ...globals.es2021,
    },
  },
  plugins: {
    react,
    'react-hooks': reactHooks,
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    ...react.configs.recommended.rules,
    'react/react-in-jsx-scope': 'off',
    ...reactHooks.configs.recommended.rules,
    'react-hooks/static-components': 'off',
    // Disable set-state-in-effect as it's too strict for legitimate use cases
    'react-hooks/set-state-in-effect': 'off',
    // React Hooks 7 promotes compiler-advisory rules into the recommended
    // preset. The existing desktop intentionally uses refs and wall-clock
    // reads in event callbacks; those patterns need focused migrations rather
    // than silently changing runtime behavior as part of build adoption.
    'react-hooks/immutability': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/refs': 'off',
  },
};

export default [
  // Globally ignored files and directories
  {
    ignores: [
      // Dependencies
      'node_modules/**',
      'package/@stackframe/**',
      // Build outputs
      'dist/**',
      'dist-electron/**',
      '**/dist/**',
      'build/**',
      'release/**',
      // Cache
      '.cache/**',
      '.vite/**',
      // Config files
      'vite.config.ts',
      'vite.config.*.ts',
      '**/vite.config.ts',
      'vitest.config.ts',
      '**/vitest.config.ts',
      'tailwind.config.js',
      '**/tailwind.config.js',
      'postcss.config.cjs',
      '**/postcss.config.cjs',
      // Generated files
      '**/*.d.ts',
      '**/*.map',
      // Generated aion edge client — byte-exact with the contract mirror
      // (bazel test //:aion_edge_client_gen); no rewriting tool may touch it
      'src/api/aion/v1/gen/**',
      // Skill payloads that run in the aion cell, not desktop source
      '**/*.py',
      // Archive (pre-refactor snapshots)
      'archive/**',
    ],
  },

  // Configuration for JavaScript files
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
  },
  // Configuration for JSX files
  {
    files: ['**/*.jsx'],
    ...js.configs.recommended,
    ...reactConfig,
    rules: {
      ...js.configs.recommended.rules,
      ...reactConfig.rules,
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  // Configuration for Storybook files (simple config, no project)
  {
    files: ['.storybook/**/*.{ts,tsx}'],
    ...reactConfig,
    languageOptions: {
      ...reactConfig.languageOptions,
      parser: typescriptParser,
    },
    rules: {
      ...reactConfig.rules,
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  // Configuration for all TypeScript files (with project)
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['.storybook/**'],
    ...reactConfig,
    languageOptions: {
      ...reactConfig.languageOptions,
      parser: typescriptParser,
      parserOptions: {
        ...reactConfig.languageOptions.parserOptions,
        projectService: true,
      },
    },
    plugins: {
      ...reactConfig.plugins,
      '@typescript-eslint': typescript,
    },
    rules: {
      ...reactConfig.rules,
      // Disable prop-types for TypeScript files as TypeScript handles type checking
      'react/prop-types': 'off',
      // Disable base rule as it conflicts with TypeScript version
      'no-unused-vars': 'off',
      // Disable no-undef for TypeScript files as TypeScript handles this
      'no-undef': 'off',
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Guardrail: in src code, always use Host abstraction instead of direct window Electron APIs
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'electronAPI',
          message:
            'Use Host abstraction (useHost/createHost) instead of window.electronAPI',
        },
        {
          object: 'window',
          property: 'ipcRenderer',
          message:
            'Use Host abstraction (useHost/createHost) instead of window.ipcRenderer',
        },
      ],
    },
  },
  // Single allowed bridge for reading global Electron APIs
  {
    files: ['src/host/createHost.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  // CRM domain: one-directional cross-store imports (spec FR-014) plus the
  // fold seam (spec FR-018). clientsStore is the root; casesStore may read
  // clientsStore; documentsStore may read clientsStore + casesStore;
  // workstreamStore may read all three. None of the four base stores may
  // import the fold — the fold reads/writes them through public actions, never
  // the reverse.
  {
    files: ['src/crm/clientsStore.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            './casesStore',
            './documentsStore',
            './workstreamStore',
            './fold/*',
            '@/crm/casesStore',
            '@/crm/documentsStore',
            '@/crm/workstreamStore',
            '@/crm/fold/*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/crm/casesStore.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            './documentsStore',
            './workstreamStore',
            './fold/*',
            '@/crm/documentsStore',
            '@/crm/workstreamStore',
            '@/crm/fold/*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/crm/documentsStore.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            './workstreamStore',
            './fold/*',
            '@/crm/workstreamStore',
            '@/crm/fold/*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/crm/workstreamStore.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['./fold/*', '@/crm/fold/*'],
        },
      ],
    },
  },
  // Prettier config (must be last to override conflicting rules)
  prettier,
];
