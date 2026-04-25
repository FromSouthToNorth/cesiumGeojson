import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  /* ===== 忽略目录 ===== */
  { ignores: ['dist', 'node_modules'] },

  /* ===== 基本语言选项 ===== */
  {
    files: ['src/**/*.{ts,tsx,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  /* ===== TypeScript 推荐规则 ===== */
  ...tseslint.configs.recommended,

  /* ===== Vue 推荐规则（扁平模式） ===== */
  ...pluginVue.configs['flat/recommended'],

  /* ===== .vue 文件解析器（vue-eslint-parser + typescript-eslint 解析 script） ===== */
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  /* ===== 项目自定义规则 ===== */
  {
    rules: {
      // 允许以 _ 开头的未使用参数（回调中常见）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 允许 any，但给出警告（Cesium API 有时需要 any）
      '@typescript-eslint/no-explicit-any': 'warn',
      // 允许单文件组件名
      'vue/multi-word-component-names': 'off',
      // console.log 警告，console.error 允许
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* ===== 禁用与 Prettier 冲突的规则 ===== */
  eslintConfigPrettier,
)
