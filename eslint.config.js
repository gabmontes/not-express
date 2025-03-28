/* eslint-disable n/no-unpublished-require */

const { defineConfig } = require("eslint/config");
const globals = require("globals");
const js = require("@eslint/js");
const nodePlugin = require("eslint-plugin-n");

module.exports = defineConfig([
  js.configs.recommended,
  nodePlugin.configs["flat/recommended"],
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.test.js"],
    rules: {
      "n/no-unsupported-features/node-builtins": ["error", { version: ">=20" }],
    },
  },
]);
