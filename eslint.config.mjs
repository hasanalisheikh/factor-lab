import coreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "services/engine/**",
      ".venv/**",
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
]

export default config
