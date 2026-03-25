# FactorLab — Contributor & Agent Instructions

## Formatting rules

This repo enforces a single formatting standard. **Always follow it; never invent one-off style.**

| Language               | Formatter   | Indent | Quotes | Semi | Trailing comma | Print width |
| ---------------------- | ----------- | ------ | ------ | ---- | -------------- | ----------- |
| TS / TSX / JS / MJS    | Prettier    | 2 sp   | double | yes  | es5            | 100         |
| JSON / YAML / CSS / MD | Prettier    | 2 sp   | —      | —    | —              | 100         |
| Python                 | Ruff format | 4 sp   | double | —    | —              | 100         |
| SQL                    | manual      | 2 sp   | —      | —    | —              | —           |

Line endings: **LF** everywhere. UTF-8. Final newline at end of file.

Config files: `.prettierrc`, `.editorconfig`, `services/engine/pyproject.toml [tool.ruff.format]`.

## Import ordering (TypeScript/JS)

Group imports in this order, separated by a blank line:

1. React / Next.js framework imports
2. Third-party packages (`lucide-react`, `recharts`, `zod`, etc.)
3. Internal app imports (`@/components/…`, `@/lib/…`, `@/app/…`)
4. Type-only imports (`import type { … }`)

Do **not** use an import sorter plugin — maintain this order manually.

## After every edit

```bash
npm run format        # Prettier: format changed files (or whole repo)
npm run lint          # ESLint: must pass with 0 warnings
npm run typecheck     # tsc --noEmit: must pass

# Python only
cd services/engine && ruff format . && ruff check .
```

Full validation suite:

```bash
npm run format:check  # CI: verify formatting
npm run lint          # CI: verify lint
npm run typecheck     # CI: verify types
npm run test:run      # CI: run Vitest tests (78 tests)
```

## Rules for Claude / automated agents

- **Always** run `npm run format` + `npm run lint` after editing TS/JS files.
- **Never** bypass the formatter with inline `// prettier-ignore` unless the specific output is semantically wrong (e.g. a manually aligned table).
- **Never** set `eslint-disable` without a comment explaining why.
- **Never** invent style in a single file (e.g. switching to single quotes, removing semicolons, using tabs).
- SQL migrations in `supabase/migrations/` are **not formatted** by any tool — keep manual style consistent with existing files (2-space indent, uppercase keywords, snake_case columns).
- Do not touch `node_modules/`, `.next/`, `services/engine/.venv/`, `playwright-audit/`, or lockfiles.
