import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

// 运行环境全局量。未声明会让 no-undef 把 Blob/URL/document/console 全部误报为未定义。
const NODE_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  __dirname: 'readonly',
  fetch: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  localStorage: 'readonly',
  fetch: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

// ESLint 9 扁平配置。`lint` 脚本此前指向不存在的配置且缺少 TS/Vue 解析器，
// 从未真正可运行；这里补齐配置与解析器，让静态检查真正生效。
export default tseslint.config(
  {
    ignores: ['dist/**', 'data/**', 'drizzle/**', 'node_modules/**', '.helloagents/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['apps/server/**/*.ts', 'tooling/**/*.ts', 'spec/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: NODE_GLOBALS },
  },
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: { globals: BROWSER_GLOBALS },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    // NestJS 装饰器注入的构造函数参数、以及 catch 中按约定命名的错误对象，
    // 用下划线前缀豁免，避免为了过 lint 而改动运行时语义。
    //
    // 模板排版类规则（属性换行、标签闭合风格）关掉：它们会对既有 .vue 产生数百条
    // 纯格式告警，与本次修复无关，留着只会淹没真正的问题。
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/attributes-order': 'off',
      // ha-min: 存量 45 处 any 集中在 API 响应解包和测试断言，降级为告警以便 lint 可用；
      // 收敛这些类型是独立的重构任务，不应阻塞当前修复。
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
