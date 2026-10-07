---
description: Full code review of a pull request, posting inline comments and resolving addressed threads
argument-hint: <pr-number>
---

You MUST review PR $ARGUMENTS right now. Do NOT ask for more information — execute all steps immediately.

## Step 0: Resolve repository and install extension

Determine the full owner/repo slug. Use the GH_REPO environment variable if available, otherwise detect it:

```bash
REPO_SLUG="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Repository: $REPO_SLUG"
```

Use $REPO_SLUG in all subsequent gh api calls instead of {owner}/{repo}.

Ensure the `gh-pr-review` extension is installed (it provides the inline review comment workflow):

```bash
gh extension install agynio/gh-pr-review --pin v1.6.2 --force 2>/dev/null || true
```

All inline review comments are posted via `gh pr-review` subcommands, NOT `gh pr review`. The built-in `gh pr review` CLI command cannot attach inline comments to specific diff lines.

## Step 0.5: Detect Jules involvement

Check the `IS_JULES` and `JULES_CONTEXT` environment variables (set by the CI workflow):

```bash
echo "IS_JULES=${IS_JULES:-false}"
echo "JULES_CONTEXT=${JULES_CONTEXT:-}"
```

The workflow sets `IS_JULES=true` when Jules (`google-labs-jules[bot]`) is involved. The `JULES_CONTEXT` value indicates the trigger:

- `jules-authored-pr`: Jules created this PR (either as author or on behalf of a human) — review it and address Jules directly
- `jules-review-submitted`: Jules posted a review — read Jules' review and respond
- `jules-review-comment`: Jules posted a review comment/suggestion — address the specific suggestion

After reading the PR in Step 2, also verify Jules involvement from the PR data:

- PR author login contains `jules`
- PR body contains `created automatically by Jules`
- Any comment author login contains `jules`

If `IS_JULES` is not set but any of these markers are found, treat `IS_JULES` as `true`.

## Step 1: Read the PR

Fetch PR metadata:

```bash
gh pr view $ARGUMENTS --json title,body,labels,author,headRefOid,baseRefName --jq '{title: .title, body: .body, labels: [.labels[].name], author: .author.login, headSha: .headRefOid, baseRef: .baseRefName}'
```

Store `headSha` — pass it as `--commit` when starting a pending review so comments anchor to the correct commit.
Store `baseRef` — used for local git diff against base branch.

## Step 2: Fetch Review Threads & Evaluate Conversation History

Fetch all review threads with full comment history:

```bash
gh pr-review review view $ARGUMENTS -R $REPO_SLUG
```

To view unresolved threads specifically:

```bash
gh pr-review review view $ARGUMENTS -R $REPO_SLUG --unresolved
```

Also check top-level PR comments if relevant:

```bash
gh pr view $ARGUMENTS --comments
```

### Evaluate Thread Comments & Developer Justifications

Examine the entire conversation history in all review threads (`reviews[].comments[].thread_comments[]` alongside the parent comment).
Developers or PR authors often reply explaining intentional design decisions, architectural trade-offs, domain constraints, or why an implementation is correct.

1. **Read all replies in thread conversations**:
   - Inspect comments from PR authors, human reviewers, or peer agents in `thread_comments[]`.
   - Extract technical claims, rationale, or domain context provided in comments.
2. **Ground and verify claims against project standards & codebase**:
   - Query `AGENTS.md` and surrounding code to verify whether the developer's claim conforms to documented project standards or intentional architecture.
3. **Assess the impact of developer justifications**:
   - **Sound & Justified Claims**: If the explanation provides a sound, technically valid justification (e.g. deliberate design override, documented exception, intentional API contract):
     - **Accept the justification**: Do NOT treat this pattern as a violation or re-raise it.
     - **Mark for auto-resolution**: If the thread is unresolved, mark the thread to be resolved in Step 3.
     - **Update review context**: Do NOT block the PR on intentional design choices.
   - **Unsound or Erroneous Claims**: If a reply makes a claim that introduces security vulnerabilities, breaks type safety, or causes genuine logic bugs:
     - Do not resolve the thread.
     - Keep the finding active and clearly explain why the justification is insufficient.
   - **Peer Reviewer Consensus**: Respect consensus from peer reviewers or agents unless a critical bug/vulnerability is present.

## Step 3: Auto-Resolve Fixed or Justified Issues

For each unresolved review thread (comments with `is_resolved: false`):

1. **Resolved by code change**: Code was modified, removed, or refactored so the reported issue no longer exists, OR the comment has `is_outdated: true`.
2. **Resolved by valid justification**: The author or reviewer provided a sound, validated explanation in thread comments (evaluated in Step 2) demonstrating that the implementation is intentional and correct.

If either condition is met, resolve the thread using DIRECT GraphQL mutation (this bypasses client-side `viewerCanResolve: false` gates):

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "[THREAD_ID]"}) {
      thread { isResolved }
    }
  }'
```

If replying with a clarification or resolution comment before resolving:

```bash
gh pr-review comments reply $ARGUMENTS \
  -R $REPO_SLUG \
  --thread-id "[THREAD_ID]" \
  --body "..."
```

## Step 4: Analyze PR and Find Issues

**Read the diff from the local checkout, never via `gh pr diff`.** The GitHub diff API refuses any PR above 300 files with HTTP 406 (`PullRequest.diff too_large`) and `gh pr diff` then silently prints nothing. The repository is checked out at full depth (`fetch-depth: 0`).

Enumerate first, then read per directory/module:

```bash
BASE="origin/${BASE_REF:-main}"
# List all changed files (excluding deletions)
git diff --name-only --diff-filter=d "$BASE"...HEAD

# Inspect diffs per module
git diff "$BASE"...HEAD -- src/lib/
git diff "$BASE"...HEAD -- src/tools/
git diff "$BASE"...HEAD -- src/dashboard/
git diff "$BASE"...HEAD -- tests/ scripts/ .github/
```

### Review Criteria (imagerouter-mcp Standards)

Check for ALL of the following (backed by `AGENTS.md`):

- **Named exports only**: No `default` exports (factory functions named `create<X>`, resolvers `resolve<X>`, tool registrars `register<ToolName>`).
- **Module system**: ESM (`"type": "module"`) with `.js` suffixes on relative imports; there is no `@/*` alias. Imports from `@modelcontextprotocol/sdk` use deep paths (`/server/mcp.js`, `/server/stdio.js`).
- **Package manager**: `bun` only (`bun.lock` committed, produced by the Bun version in `packageManager`) — never `npm`/`pnpm`/`yarn` lockfiles. `npm` is the publish registry only. `CHANGELOG.md` and the `package.json` version are owned by `semantic-release` and must not be edited by hand.
- **Runtime and build**: The bin targets **Bun**, not Node (`#!/usr/bin/env bun`, `Bun.serve`, `import.meta.dir`). `scripts/build.ts` bundles `src/cli.ts` and the dashboard UI into `dist/` and compiles the Tailwind CSS. `tsc` is `--noEmit` only. Flag anything that assumes a Node-only runtime or adds a second build target.
- **Type safety**: TypeScript `strict` mode. No `any`, no `@ts-ignore`/`@ts-expect-error` (unused vars allowed if prefixed `_`).
- **Zod validation**: All tool inputs validated with Zod v4 schemas passed as `inputSchema` to `registerTool` — the MCP SDK validates before the handler runs. Shared fields live in `src/tools/schemas.ts`; the dashboard reuses them.
- **Error surface**: Tool handlers catch failures and return `formatToolError(error)` (`{ content: [...], isError: true }`) — never rethrow, never leak stack traces. Successful results are `JSON.stringify(data, null, 2)` in one text block. The status-to-code mapping lives in `src/lib/errors.ts`; do not special-case a status at a call site.
- **stdout is the protocol**: In MCP mode nothing but protocol frames may reach stdout. `console.error`/`console.warn` only under `src/` — no `console.log` (oxlint enforces `no-console`). Only the dashboard mode prints to stdout, on purpose.
- **Tool annotations**: `generate_image`, `edit_image` and `generate_video` set `readOnlyHint: false` (they spend credits and write files); `list_models` and `get_credits` set `readOnlyHint: true`. A new tool sets the right one.
- **HTTP boundary**: `ImageRouterClient` (`src/lib/imagerouter-client.ts`) is the only module that calls `fetch`, for API calls and result downloads alike. No raw `fetch`/axios in tool handlers, the dashboard or entrypoints. Tests inject `fetch` into the client.
- **Single generation flow**: `runGeneration` (`src/lib/generation.ts`) is the only generation flow; the MCP tools and the dashboard both call it. Flag any reimplemented step.
- **Billing honesty**: After a generation succeeded the request is billed. A failure while downloading or saving must say where the results are (hosted URLs, files already saved), and a timeout or connection error on a generation call must warn that the request may still be billed.
- **Saved files**: Extensions come from the bytes' signature first, then Content-Type, URL, the requested format; unknown types are saved as `.bin`. File names are confined to the output directory.
- **No HTTP MCP transport, no Dockerfile**: Both are deliberate omissions (results are written to the server's local disk, which a remote client could not reach). Flag a Streamable HTTP entry point or a container setup.
- **Dashboard security boundary**: `src/dashboard/serve.ts` binds `127.0.0.1` only and is the only file that touches `Bun.serve`; `routes.ts` stays a pure `Request -> Response` function. The Host check and the Origin check on non-GET requests must not be weakened; the dashboard must not accept paths from the browser (`output_dir`, `images`, `masks`); `/files/:name` takes a bare file name only; responses keep `x-content-type-options: nosniff`.
- **Testing**: `bun run test` (Vitest) never touches the network. Unit tests per lib module in `tests/unit/`, integration tests in `tests/integration/` that drive the real MCP server through an in-memory client and the dashboard handler directly, both with an injected fake `fetch` (`tests/helpers/fake-fetch.ts`). A new tool needs a success path and at least one error status in `tests/integration/tools.test.ts`. `tests/live/` runs only through `bun run test:live`, is skipped without `IMAGEROUTER_API_KEY`, and uses only the free models `test/test` and `ir/test-video` — a paid model there is a blocking finding.
- **CI**: Workflows pin `bun-version: '1.4.2'` to match `packageManager`. `bun run test:live` must not appear in any workflow.

**What to Avoid**:

- Do NOT comment on pre-existing code outside of this PR's diff.
- Do NOT comment on formatting that oxfmt handles.

## Step 4.5: Run the gates

The workflow installs the toolchain before handing the PR over, so the checks
this diff has to pass are runnable here. Do not report a finding you could have
confirmed or refuted by running them. Never run `bun run test:live`: it needs an API key and the real ImageRouter API.
`bun run test` is offline and fast and may be run when a finding depends on it.

```bash
echo "TOOLCHAIN_READY=${TOOLCHAIN_READY:-false}"
```

If `TOOLCHAIN_READY` is `false`, the dependency install failed. Skip this step,
review from the diff alone, and say so in one sentence in the review body — a
lockfile that will not install is itself worth mentioning.

Otherwise:

```bash
bun run type-check
bun run format:check
# Lint only what this PR touched.
# Each Bash call is its own shell, so re-derive BASE here.
BASE="origin/${BASE_REF:-main}"
CHANGED=$(git diff --name-only --diff-filter=d "$BASE"...HEAD -- '*.ts' '*.tsx')
[ -n "$CHANGED" ] && bun run lint $CHANGED
```

How to read the output:

- **Type errors**: blocking. If the failing file is not in this PR's diff, it is
  pre-existing — note it in the review body rather than as a finding on a line
  nobody here wrote.
- **Lint warnings on changed lines**: report them. Warnings do not fail the Lint
  gate, so a new one reaches `main` unless a reviewer names it. Report the rule
  and what it flags, not a style opinion.
- **`format:check` failures**: only the files this PR touched are this PR's to
  report — one line in the review body naming them, and no per-line formatting
  comments. `oxfmt` walks the whole workspace and formats JSON and Markdown as
  well as TS, so a single unreadable or unparseable file anywhere fails the run
  with exit 2 and says nothing about the diff. When the named file is outside
  the diff, re-check this PR's own files instead and report that:

  ```bash
  BASE="origin/${BASE_REF:-main}"
  git diff --name-only --diff-filter=d "$BASE"...HEAD | xargs -r bunx oxfmt --check
  ```

  Build that list here rather than reusing the lint step's `$CHANGED`: that one
  is filtered to source extensions, so a PR touching none of them leaves it
  empty — and `oxfmt --check` with no paths is the whole-workspace check again,
  reproducing the failure this bullet exists to keep out of the review. The
  `xargs -r` is what stops an empty list from doing that.

State in the review body which of these you actually ran. A review that claims
verification it did not perform is worse than one that admits reading only the
diff. The same holds for causes: name one only from output you actually saw in
this run. Before handing the PR over, the CI action restores its own set of
paths from the base branch — `.claude`, `.mcp.json`, `.claude.json`,
`.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md`, `.husky` — and logs
that it did; that log line alone is not evidence that one of them broke a gate.
Note what is not on that list: `.claude-pr/` is written by the action, not
restored from base, so a failure there is still a failure worth reading.

## Step 5: Deduplicate Findings

For each finding identified in Step 4, check UNRESOLVED threads for semantic matches:

- Same file + same issue type within nearby lines (allow ±5 line shift) = DUPLICATE (skip)
- Already discussed and pending resolution in an active thread = DUPLICATE (skip)
- Same file + different function/root cause = NEW (include)

Categorize into **new_issues** and **old_issues**.

## Step 6: Mapping Findings to Diff Lines

GitHub inline review comments MUST reference a line that exists in the PR diff:

- **Added/context lines** (RIGHT side): `--side RIGHT`, count line numbers from `+NEW_START` in the diff hunk header.
- **Removed lines** (LEFT side): `--side LEFT`, count line numbers from `-OLD_START` in the diff hunk header.
- Findings that do not map to a specific diff line belongs in the review `--body` summary, not inline.

## Step 7: Post Review

**Decision logic:**

1. `new_issues` has items -> Submit review with `event=REQUEST_CHANGES` and all inline comments.
2. `new_issues` empty + unresolved threads == 0 (all issues either fixed, justified & resolved, or clean) -> Submit review with `event=APPROVE` (no comments).
3. `new_issues` empty + unresolved threads > 0 (genuine issues still legitimately outstanding without sound justification) -> **Do NOT submit a review** (existing inline comments remain visible).

### Submit Batched Review with Inline Comments

```bash
# 1. Start pending review pinned to HEAD SHA
REVIEW_JSON=$(gh pr-review review --start $ARGUMENTS \
  -R $REPO_SLUG \
  --commit "$HEAD_SHA")
REVIEW_ID=$(echo "$REVIEW_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 2. Add each inline comment using the captured REVIEW_ID
gh pr-review review --add-comment $ARGUMENTS \
  -R $REPO_SLUG \
  --review-id "$REVIEW_ID" \
  --path "src/lib/example.ts" \
  --line 42 \
  --side RIGHT \
  --body "**[P1]** Issue description and rationale.

\`\`\`suggestion
replacement code here
\`\`\`"

# 3. Submit the review
gh pr-review review --submit $ARGUMENTS \
  -R $REPO_SLUG \
  --review-id "$REVIEW_ID" \
  --event REQUEST_CHANGES \
  --body "## Code Review

Summary of findings..."
```

Comment body conventions:

- Start each inline body with severity tag: `[P0]` critical/security, `[P1]` high-impact bug, `[P2]` defect/convention violation, `[P3]` nit.
- **Include a `suggestion` block whenever proposing a concrete code fix.** GitHub renders ` ```suggestion ` fenced blocks inside inline review comments as apply-able "Commit suggestion" buttons.
- The suggestion block content MUST be valid replacement code without diff markers (`+`/`-`).

### For APPROVE (clean PR, single atomic call):

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/$REPO_SLUG/pulls/$ARGUMENTS/reviews \
  -f event='APPROVE' \
  -f commit_id="$HEAD_SHA"
```

### When Jules is involved (`IS_JULES=true`):

The review body MUST start with `@jules` on the first line so Jules detects and acts on the review:

```markdown
@jules

[Review content...]
```

## Step 8: Print Summary

Print a single summary line:

```
Reviewed PR #$ARGUMENTS: <APPROVE / REQUEST_CHANGES / COMMENT> — <one-line summary>. <N> inline comments posted.
```

## Rules

- Do NOT push commits or modify repository files.
- Do NOT apply labels or merge the PR.
- Always read diff locally against `origin/${BASE_REF:-main}`, never via `gh pr diff`.
- Auto-resolve threads via direct GraphQL `resolveReviewThread` mutation when issues are fixed or justified.
- Evaluate thread replies and respect sound developer justifications.
- Use `gh pr-review` subcommands for inline comments, passing captured `--review-id`.
- Anchor reviews to the exact HEAD SHA.
