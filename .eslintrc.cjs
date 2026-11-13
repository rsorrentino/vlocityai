/**
 * ESLint configuration for the Node.js server and scripts.
 * The React client has its own config (client/.eslintrc.cjs, `npm --prefix client run lint`).
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['node_modules/', 'client/', 'coverage/', 'data/', 'logs/'],
  rules: {
    // Never spawn external processes through a shell (see server/utils/processRunner.js)
    'no-restricted-properties': [
      'error',
      { object: 'child_process', property: 'exec', message: 'Use runCommand() from server/utils/processRunner.js' },
      { object: 'child_process', property: 'execSync', message: 'Use runCommand() from server/utils/processRunner.js' },
    ],
    'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, caughtErrors: 'none' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    'no-control-regex': 'off',
    'no-prototype-builtins': 'warn',
    'no-case-declarations': 'warn',
    'no-inner-declarations': 'warn',
    'no-async-promise-executor': 'warn',
    'no-constant-condition': ['warn', { checkLoops: false }],
  },
  overrides: [
    {
      files: ['server/__tests__/**/*.js'],
      env: { jest: true },
    },
  ],
};
