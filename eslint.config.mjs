import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import importPlugin from "eslint-plugin-import";
import depend from "eslint-plugin-depend";
import sdl from "@microsoft/eslint-plugin-sdl";
import json from "@eslint/json";
import globals from "globals";

const commonRules = {
	"no-unused-vars": "off",
	"no-prototype-bultins": "off",
	"no-self-compare": "warn",
	"no-eval": "error",
	"no-implied-eval": "error",
	"prefer-const": "off",
	"no-implicit-globals": "error",
	"no-console": ["error", { allow: ["warn", "error", "debug"] }],
	"no-restricted-globals": [
		"error",
		{
			name: "app",
			message:
				"Avoid using the global app object. Instead use the reference provided by your plugin instance.",
		},
		"warn",
		{
			name: "fetch",
			message:
				"Use the built-in `requestUrl` function instead of `fetch` for network requests in Obsidian.",
		},
		{
			name: "localStorage",
			message:
				"Prefer `App#saveLocalStorage` / `App#loadLocalStorage` functions to write / read localStorage data that's unique to a vault.",
		},
	],
	"no-restricted-imports": [
		"error",
		{
			name: "axios",
			message:
				"Use the built-in `requestUrl` function instead of `axios`.",
		},
		{
			name: "superagent",
			message:
				"Use the built-in `requestUrl` function instead of `superagent`.",
		},
		{
			name: "got",
			message:
				"Use the built-in `requestUrl` function instead of `got`.",
		},
		{
			name: "ofetch",
			message:
				"Use the built-in `requestUrl` function instead of `ofetch`.",
		},
		{
			name: "ky",
			message:
				"Use the built-in `requestUrl` function instead of `ky`.",
		},
		{
			name: "node-fetch",
			message:
				"Use the built-in `requestUrl` function instead of `node-fetch`.",
		},
		{
			name: "moment",
			message:
				"The 'moment' package is bundled with Obsidian. Please import it from 'obsidian' instead.",
		},
	],
	"no-alert": "error",
	"no-undef": "error",
	"@typescript-eslint/ban-ts-comment": "off",
	"@typescript-eslint/no-deprecated": "error",
	"@typescript-eslint/no-unused-vars": ["warn", { args: "none" }],
	"@typescript-eslint/require-await": "off",
	"@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: true }],
	"@microsoft/sdl/no-document-write": "error",
	"@microsoft/sdl/no-inner-html": "error",
	"import/no-nodejs-modules": "error",
	"import/no-extraneous-dependencies": "error",
	"obsidianmd/commands/no-command-in-command-id": "error",
	"obsidianmd/commands/no-command-in-command-name": "error",
	"obsidianmd/commands/no-default-hotkeys": "error",
	"obsidianmd/commands/no-plugin-id-in-command-id": "error",
	"obsidianmd/commands/no-plugin-name-in-command-name": "error",
	"obsidianmd/settings-tab/no-manual-html-headings": "error",
	"obsidianmd/settings-tab/no-problematic-settings-headings": "error",
	"obsidianmd/vault/iterate": "error",
	"obsidianmd/detach-leaves": "error",
	"obsidianmd/hardcoded-config-path": "error",
	"obsidianmd/no-forbidden-elements": "error",
	"obsidianmd/no-plugin-as-component": "error",
	"obsidianmd/no-sample-code": "error",
	"obsidianmd/no-tfile-tfolder-cast": "error",
	"obsidianmd/no-view-references-in-plugin": "error",
	"obsidianmd/no-static-styles-assignment": "error",
	"obsidianmd/object-assign": "error",
	"obsidianmd/platform": "error",
	"obsidianmd/prefer-file-manager-trash-file": "warn",
	"obsidianmd/prefer-abstract-input-suggest": "error",
	"obsidianmd/regex-lookbehind": "error",
	"obsidianmd/sample-names": "error",
	"obsidianmd/validate-manifest": "error",
	"obsidianmd/validate-license": ["error"],
	"obsidianmd/ui/sentence-case": [
		"error",
		{ enforceCamelCaseLower: true },
	],
};

const plugins = {
	import: importPlugin,
	"@microsoft/sdl": sdl,
	obsidianmd,
	depend,
};

const tsGlobals = {
	...globals.browser,
	...globals.node,
};

export default [
	// 忽略构建产物
	{
		ignores: ["main.js"],
	},

	// 基础 JavaScript 推荐规则（全局）
	js.configs.recommended,

	// JavaScript + TypeScript 基础推荐规则
	...tseslint.configs.recommended,

	// JavaScript 文件额外规则
	{
		files: ["**/*.js", "**/*.jsx"],
		plugins,
		rules: commonRules,
	},

	// TypeScript 类型检查规则（仅作用于 TS 文件）
	...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
		...cfg,
		files: cfg.files ?? ["**/*.ts", "**/*.tsx"],
	})),

	// TypeScript 文件额外规则 + 类型信息配置
	{
		files: ["**/*.ts", "**/*.tsx"],
		plugins,
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.json",
			},
			globals: tsGlobals,
		},
		rules: commonRules,
	},

	// package.json
	{
		files: ["package.json"],
		plugins: {
			depend,
			json,
		},
		language: "json/json",
		rules: {
			"no-irregular-whitespace": "off",
			"depend/ban-dependencies": [
				"error",
				{ presets: ["native", "microutilities", "preferred"] },
			],
		},
	},

	// esbuild.config.mjs 允许 Node.js 模块 / Allow Node.js modules in esbuild config
	{
		files: ["esbuild.config.mjs"],
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},

	// scripts/ 中的 CJS 脚本允许 require / CJS scripts in scripts/ allow require
	{
		files: ["scripts/**/*.cjs"],
		rules: {
			"@typescript-eslint/no-require-imports": "off",
			"import/no-nodejs-modules": "off",
		},
		languageOptions: {
			globals: globals.node,
		},
	},

	// settings.ts 中的 'Share-to-Save' 是插件品牌名/默认文件夹名，不是自然语言句子
	// 'Share-to-Save' in settings.ts is a plugin brand name / default folder name, not a natural language sentence
	{
		files: ["src/settings.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": "off",
		},
	},

	// 测试文件允许使用 any 类型以进行 mock / Test files allow any type for mocking purposes
	{
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
		},
	},
];
