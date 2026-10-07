<!-- These comments never render. Keep the body short: someone with no context should
     understand what changes, and why, in under a minute. -->

# Replace this heading with a one-line description of the issue

<!-- ↑ The issue, not the fix. e.g. "# generate_image rejects sizes the API accepts"

     ↓ Then two or three sentences on what this PR covers, for someone who reads no
     further: the areas it touches, and what it deliberately leaves alone.
     Flowing prose, not bullets — the bullets start at Why.                       -->

## Intent

### Why

<!-- One bullet per reason, each with evidence a reviewer can check: a finding, an
     incident, an issue, a version, a link. The diff shows what changed and never why,
     so this is the half that decides whether the change is right.
     e.g. - #12 reports a 400 for `size` values the API accepts; the model catalogue
            lists them and the Zod schema in `src/tools/schemas.ts` rejects them.  -->

-

### What

<!-- One bullet per change: what it DOES and where (app, area, module). Not a file list —
     the diff already has that, and not a restatement of Why. Last bullet: anything
     deliberately left out.
     e.g. - `src/tools/schemas.ts`: `size` accepts any `WxH` string; the preset sizes stay
            as documented examples.
          - Not included: dashboard changes — that is #14.                        -->

-

## Verification

<!-- The real commands and the real numbers. Name the gates you ran — `bun run lint`,
     `bun run type-check`, `bun run format:check`, `bun run test` (see `AGENTS.md`) — and
     what they actually reported; if you ran a subset, say which and why. A change to the
     dashboard (`src/dashboard/`) is exercised by hand in a browser: say what you clicked
     and what you saw. `bun run test:live` is opt-in and spends no credits only on the free
     models; say if you ran it. Close with what you did NOT verify: a gap named beats a
     claim unchecked. -->

## Test Plan

<!-- Boxes a reviewer ticks before merging; an unticked one is a question worth asking. -->

- [ ] CI passes
- [ ] Title is a Conventional Commits subject — it becomes the squash commit subject and is what the release tooling reads
- [ ] `AGENTS.md` is still accurate for this change (conventions, commands, architecture, lint rules)
