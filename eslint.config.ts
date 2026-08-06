import { defineConfig } from 'eslint-define-config'

export default defineConfig({
  root: true,
  env: {
    browser: true,
    es2023: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // 关闭 Vue 组件名称必须多单词的限制
    'vue/multi-word-component-names': 'off',
    // 允许使用 any
    '@typescript-eslint/no-explicit-any': 'warn',
    // 允许未使用的变量（以下划线开头）
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
  },
  ignores: ['node_modules', 'dist', '**/*.d.ts'],
})
