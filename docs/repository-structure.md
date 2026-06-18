# Repository Structure

FactorLab keeps product code in domain folders and leaves only tool-required entrypoints at the
repository root.

## Root Directory

The root should stay small and intentional:

- `app/` - Next.js App Router routes, server actions, and API routes.
- `components/` - reusable React components and component-specific helpers.
- `hooks/` - shared React hooks.
- `lib/` - shared TypeScript domain logic, Supabase access, reports, metrics, and utilities.
- `config/` - tool support files that can be safely moved out of root, such as Vitest shims.
- `services/engine/` - Python compute engine, worker orchestration, and repository adapters.
- `supabase/` - schema, migrations, templates, and local Supabase configuration.
- `scripts/` - local maintenance and smoke-test entrypoints.
- `docs/` - product, architecture, deployment, audit, and archive documentation.
  - `docs/agents/` - explanatory notes for automated coding agents; root agent files stay as
    required tool entrypoints.
- `styles/` - global style compatibility files.
- `.github/` - CI and scheduled workflow definitions.
- `.vscode/` - folder-level editor policy for formatting and explorer hygiene.
- `playwright-audit/` - specialized browser audit harness retained for deeper QA, hidden from the
  everyday VS Code explorer view.

## Root Files That Must Stay

Several files look noisy but are intentionally rooted because external tools discover them there:

- `package.json` and `package-lock.json` for npm scripts and dependency locking.
- `next.config.mjs` and `next-env.d.ts` for Next.js.
- `tsconfig.json` for TypeScript.
- `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, and `.editorconfig` for code quality.
- `postcss.config.mjs` for Tailwind/PostCSS.
- `vitest.config.ts` for Vitest discovery. Test-only shims live in `config/vitest/`.
- `vercel.json` and `render.yaml` for deployment platforms.
- `components.json` for shadcn/ui configuration.
- `proxy.ts` for Next.js proxy behavior.
- `AGENTS.md` and `CLAUDE.md` for contributor and agent policy. `AGENTS.md` is the shared source of
  truth; `CLAUDE.md` is intentionally only a pointer.
- `README.md` for the public project entrypoint.

Do not move these unless the associated tool is reconfigured and validation proves the move works.

## Generated And Local Files

These files and folders should not be committed and are hidden in the recommended VS Code explorer
settings:

- `node_modules/`
- `.next/`
- `.vercel/`
- `.venv/`
- `.tmp-engine-venv/`
- `.ruff_cache/`
- `tsconfig.tsbuildinfo`
- `supabase/.temp/`
- `supabase/.branches/`
- `playwright-audit/`
- `playwright-audit/node_modules/`
- `playwright-audit/playwright-report/`
- `playwright-audit/test-results/`

The recommended VS Code settings also nest root entrypoints and configuration files under
`README.md` or `package.json` so the explorer emphasizes product folders instead of required
toolchain files.

For the cleanest Explorer view, open `factor-lab.code-workspace` instead of opening the folder
directly. It repeats the same hide and nesting policy at workspace scope, which helps when VS Code
does not pick up folder settings immediately.

If one of these appears in `git status`, stop and fix ignore rules before committing.

## Source Organization Rules

- Keep production source files between 100 and 400 lines when practical.
- The hard maximum for hand-written production source is 500 lines.
- Split by responsibility before adding behavior to a large file.
- Keep tests near their owning area or in the existing `__tests__` convention.
- Keep generated Supabase types and vendored shadcn/ui scaffolding out of production-source
  file-length enforcement.
- Update related docs whenever folder structure, setup, operations, schema, or product behavior
  changes.
