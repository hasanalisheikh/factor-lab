# FactorLab — Contributor & Agent Instructions

## Source of truth

All coding agents must read this file before changing the repository. Tool-specific files such as
`CLAUDE.md` must point here instead of duplicating policy.

## Maintainability rules

- Target 100-400 lines per source file.
- 500 lines is a hard maximum for hand-written source files.
- Split files by responsibility before adding behavior to an oversized file.
- Generated files, dependency folders, build outputs, and lockfiles are excluded from the line-count
  rule.
- The automated `npm run check:file-length` gate enforces production source. Docs, tests, generated
  Supabase types, and vendored shadcn/ui scaffolding are excluded from that command but should still
  be split when they become hard to review.
- Keep the repository root intentionally small. Product code belongs in `app/`, `components/`,
  `hooks/`, `lib/`, `services/engine/`, `scripts/`, `supabase/`, or `styles/`; docs and process
  notes belong in `docs/`; movable tool support belongs in `config/`. Only tool-required config and
  entrypoint files should live at root.
- Keep `AGENTS.md` as the shared source of truth for automated coding agents. Tool-specific files
  such as `CLAUDE.md` must stay short and point back here; longer agent notes belong in
  `docs/agents/`.
- Before adding a new root file or folder, check [docs/repository-structure.md](docs/repository-structure.md)
  and prefer an existing domain folder.
- Update relevant docs whenever product behavior, setup, schema, env, or operations change.

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
npm run format
npm run lint
npm run typecheck
```

For Python changes:

```bash
cd services/engine && ruff format . && ruff check .
```

Full validation suite once Task 2 has added the file-length guard:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run check:file-length
```

## Environment and migration safety

- Never print secret values from `.env`, `.env.local`, Supabase, Vercel, or shell history.
- Check only whether required env keys are present unless the user explicitly asks otherwise.
- Do not commit `.env.local`, Supabase `.temp`, Python virtualenvs, or generated package metadata.
- Before applying migrations to a remote Supabase project, confirm the target project and capture the
  migration list.
- SQL migrations in `supabase/migrations/` are manually styled with 2-space indentation, uppercase
  SQL keywords, and snake_case columns.

## Do not touch

- `node_modules/`
- `.next/`
- `.venv/`
- `services/engine/.venv/`
- `playwright-audit/`
- lockfiles unless the user explicitly approves dependency changes
