import base from '@markethub/config/eslint';
import globals from 'globals';

export default [
  ...base,
  {
    // Nest DI reads constructor param types at runtime; this tells
    // consistent-type-imports not to turn those into `import type`.
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
  { files: ['test/**', '**/*.spec.ts'], languageOptions: { globals: { ...globals.jest } } },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
