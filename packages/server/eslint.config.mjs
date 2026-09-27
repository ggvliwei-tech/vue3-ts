// @ts-check
/**
 * server 端 ESLint 9 flat config
 *
 * 启用 recommendedTypeChecked（类型感知规则）—— 这是 server 相对前端多出来的一层保障。
 *
 * 格式策略与根配置保持一致：ESLint 只负责代码质量，格式化统一交给 prettier CLI
 * （`pnpm format` / `pnpm format:check`）。此前这里用的是 eslint-plugin-prettier，
 * 把格式违规变成了 lint error —— 而 server 代码从未跑过 prettier，
 * 因而积累了 1000+ 条纯格式 "error"，把真正的类型问题淹没在其中。
 */
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',

      // ---- 存量类型债务：降为 warn ----
      // 以下规则在 recommendedTypeChecked 中默认为 error，本仓库存量代码约 1300 处违规，
      // 成因是 TypeORM / Socket.IO / 各类三方 SDK 的类型缺口导致 any 沿调用链传播，
      // 逐条收敛属于专项类型治理，不适合与功能改动混在一起。
      // 降为 warn 后 `lint:check` 才能作为门禁使用（CI 中配 --quiet 只看 error），
      // 同时保留可见性 —— 新代码不应再引入这些告警。
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',

      // 未处理的 Promise 会导致静默失败，保持可见（沿用原配置级别）
      '@typescript-eslint/no-floating-promises': 'warn',

      // 与根配置一致：以 _ 前缀标记「有意未使用」的参数/变量
      // （如预留待实现的 SDK 接口参数），避免为通过检查删掉有语义的签名
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // 必须放最后：关闭所有与 Prettier 冲突的格式化规则
  prettierConfig,
);
