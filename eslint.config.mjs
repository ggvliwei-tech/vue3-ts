// @ts-check
/**
 * 仓库根 ESLint 9 flat config
 *
 * 覆盖范围：根目录下的构建脚本 + packages/{shared,admin,app}
 *
 * 关于 packages/server：它自带一套 eslint.config.mjs（使用 recommendedTypeChecked
 * 启用类型感知规则），此处显式忽略，由 `pnpm --filter @project/server lint` 单独跑，
 * 避免两套规则互相覆盖。
 *
 * 前端三包（shared / admin / app）只启用「非类型检查」规则集：
 * 类型正确性交给 vue-tsc / tsc（见各包 type-check 脚本），
 * 而 type-checked 规则在 a11y 与 any 密集的存量前端代码上噪声过大。
 *
 * 注：原先的 eslint.config.ts 是 ESLint 8 的 eslintrc 格式（root/env/extends/parser），
 * ESLint 9 的 flat config 引擎完全不识别这些字段，且其依赖的 eslint-define-config 从未安装，
 * 因此该配置此前从未生效过。
 */
import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.d.ts',
      // 自动生成的文件
      '**/auto-imports.d.ts',
      '**/components.d.ts',
      // server 自管（见文件头说明）
      'packages/server/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  // 前端源码：浏览器环境 + 用 TS parser 解析 <script lang="ts">
  {
    files: ['packages/{shared,admin,app}/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // 构建脚本跑在 Node 环境
  {
    files: ['**/vite.config.{ts,js,mjs}', '**/*.config.{ts,js,mjs}', 'scripts/**/*.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 必须放最后：关闭所有与 Prettier 冲突的格式化规则。
  // 格式化统一交给 prettier（见根 `format` 脚本），ESLint 只负责代码质量，
  // 否则两者会互相改写（lint 要求每行一个属性 / prettier 又合并回一行）形成死循环。
  prettierConfig,
)
