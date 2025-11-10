import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import ts from 'typescript-eslint';

export default [
  { name: 'globals', ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'db.json'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    plugins: { import: pluginImport },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },
];
