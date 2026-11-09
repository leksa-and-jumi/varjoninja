import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', '.wrangler'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      eqeqeq: 'error',
      // noUncheckedIndexedAccess makes every array lookup optional; voxel code
      // reads arrays by index a lot, so `!` is the clearest way to say "always there".
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
