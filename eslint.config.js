/**
 * ESLint configuration (flat config).
 *
 * Recommended rules for JavaScript and Vue 3, plus the house style:
 * no ternaries (an explicit if / else reads better) and braces around every
 * block. Formatting is Prettier's job: eslint-config-prettier, applied
 * last, turns off the rules it would fight with.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  {
    ignores: ['client/dist/**', 'data/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // Server, CLI and tooling: Node.js.
    files: ['server/**/*.js', 'bin/**/*.js', '*.js', 'client/vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // The Vue application: the browser.
    files: ['client/src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    rules: {
      curly: ['error', 'all'],
      'no-ternary': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
    },
  },
  prettier,
];
