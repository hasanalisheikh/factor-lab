# Agent Entry Points

FactorLab keeps agent policy discoverable for automated tools while keeping everyday documentation
organized under `docs/`.

## Required Root Files

- `AGENTS.md` is the source of truth for all automated coding agents.
- `CLAUDE.md` is a tiny Claude-specific shim that points back to `AGENTS.md`.

These files stay at the repository root because agent tools discover them there. Do not move them
unless every supported agent has been reconfigured and validated.

## Where Agent Docs Belong

- Put shared agent policy in `AGENTS.md`.
- Put explanatory or historical agent notes in this `docs/agents/` folder.
- Keep tool-specific root files as short pointers to `AGENTS.md`.
- Update `docs/repository-structure.md` whenever root entrypoints change.

## Explorer Hygiene

The workspace settings nest `AGENTS.md`, `CLAUDE.md`, and root formatter/config files under
`README.md` or `package.json` in VS Code. The files remain available to tools, but they do not
dominate the top-level explorer view.
