import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier";

const config = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "services/engine/**",
      ".venv/**",
      "playwright-audit/**",
    ],
  },
  {
    rules: {
      // Allow underscore-prefixed params (common convention for intentionally unused args,
      // e.g. server action signatures required by useActionState).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Must be last: disables ESLint rules that conflict with Prettier
  eslintConfigPrettier,
];

export default config;
