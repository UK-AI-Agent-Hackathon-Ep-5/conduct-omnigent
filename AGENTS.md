# Agent guidance

Guidance for AI agents (Claude Code, Copilot, Cursor, etc.) working in this
repository. See `CONTRIBUTING.md` for the full contributor workflow.

Omnigent is a **meta-harness**: a common orchestration layer over many coding
agents (Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, and custom
YAML-defined agents). It runs as a CLI, a local/deployed server with a web UI,
and a native desktop app. The package is `omnigent`; the CLI is `omnigent` (with
the short alias `omni`).

## Commands

Dev environment (macOS/Linux only — Windows uses WSL2; see `CONTRIBUTING.md`):

```bash
uv venv --python "$(cat .python-version)"   # Python 3.12
uv sync --extra all --extra dev
source .venv/bin/activate                    # or prefix commands with `uv run`
```

Common checks (CI runs the same ones via `pre-commit`):

```bash
uv run pytest                                # unit/inner tests; e2e + integration skipped by default
uv run pytest tests/server/                  # one area suite
uv run pytest tests/server/test_foo.py::test_bar   # a single test
uv run pytest tests/integration              # opt in to the integration suite (ignored by default)
uv run ruff check . && uv run ruff format --check .
uv run pre-commit run --all-files
```

- `tests/e2e`, `tests/e2e_ui`, `tests/e2e_live`, and `tests/integration` are
  `--ignore`d by default (they need real LLM credentials or extra setup); run
  them by naming the path explicitly.
- Default per-test timeout is 300s (thread method). Live/real-LLM tests use
  `@pytest.mark.live`, `model(...)`, and `llm_flaky(...)` markers — see
  `[tool.pytest.ini_options]` in `pyproject.toml`.

Frontend (`web/`, requires Node 22+):

```bash
cd web && npm install && npm run lint && npm run build
npm test                                     # Vitest unit tests
npm run dev                                  # Vite dev server (usually :5173)
```

Run the stack locally (three terminals): `omnigent server` (:6767), then
`omnigent host --server http://localhost:6767`, then `cd web && npm run dev`.
For a fast backend-only smoke check, `scripts/backend-smoke.sh` boots an
isolated, disposable server and hits `/health`, `/docs`, `/v1/agents`, etc.

## Architecture

An **agent** is defined by a portable YAML **spec** (prompt, tools, sub-agents,
policies, executor/harness choice). A **runtime** executes a spec. See
`docs/AGENT_YAML_SPEC.md` and `examples/polly/`, `examples/debby/`.

Core packages under `omnigent/`:

- `spec/` — the language-neutral agent definition (what an agent *is*): parser,
  validator, types. The portable contract between agent authors and runtimes.
- `runtime/` — the execution engine (how an agent *runs*): the reasoning loop,
  LLM invocation, tool calls, skills, compaction. A **library**, not a service;
  the server is its primary host.
- `runner/` — per-session orchestration wiring: tool dispatch, MCP managers,
  routing, cost advisor/judge, pending approvals, transports.
- `server/` — the multi-tenant HTTP service (FastAPI): accounts/auth, host
  registry, managed hosts, session APIs, and it serves the web UI. See
  `omnigent/server/API.md` and `DBSPEC.md`.
- `host/` — registers a machine as a place sessions can run; git worktrees,
  daemon launch, local server connection.
- `inner/` — pre-unification code, most notably the **harness executors**. Each
  supported agent has an `*_executor.py` + `*_harness.py` pair (e.g.
  `claude_sdk_*`, `codex_*`, `cursor_*`, `hermes_*`, `pi_*`, `opencode_*`,
  `antigravity_*`). Imports *into* `inner` use the explicit `omnigent.inner.X`
  path so the boundary is grep-findable.
- Top-level `omnigent/*_native.py` (e.g. `claude_native.py`, `codex_native.py`)
  — the **native** terminal wrappers that drive a vendor's real CLI inside a
  tmux/PTY pane, bridging its I/O, permissions/elicitation, and cost into an
  Omnigent session. These are distinct from the SDK/in-process harnesses in
  `inner/`.
- `tools/` — tool system: local Python callables, MCP clients, builtins,
  client-specified tools. `policies/` — governance (allow/block/ask, spend
  caps); builtins in `policies/builtins/`. `llms/` — provider-agnostic LLM
  client, adapters, routing, summarization.
- `stores/` + `entities/` + `db/` — persistence. `entities/` are the domain
  models; `stores/` are the repositories; `db/` holds SQLAlchemy models and
  Alembic migrations (`omnigent/db/migrations`).
- `repl/` — the terminal chat UI; `onboarding/` — setup/credential flows;
  `sandbox/` — OS sandboxing (`bwrap` on Linux, `seatbelt` on macOS).

Two harness flavors matter when adding agent support: **SDK/in-process**
harnesses (`inner/*_harness.py`, run the vendor's SDK inside our runtime) and
**native** wrappers (`*_native.py`, drive the vendor's CLI in a terminal). A new
harness typically touches both a spec `executor.harness` value and the matching
executor pair.

Sibling packages: `sdks/python-client` (`omnigent_client`) and `sdks/ui`
(`omnigent_ui_sdk`) are path-deps installed editable; the web frontend lives in
`web/`. Design docs live in `designs/` and `docs/`.

## Committing

Run the `pre-commit` hook before committing (`pre-commit run --all-files`, or
let it run on staged files via `git commit`). Fix any issues it reports so the
commit lands clean — CI runs the same checks.

## Pull requests

When you open a pull request, fill in the repo's PR template at
`.github/pull_request_template.md` (case-sensitive on Linux — note the lowercase
filename). Keep every section and checkbox row so reviewers can skim them.

- **Summary** — what changed and why.
- **Test Plan** — how you verified it.
- **Demo** — a **video or images** showing the change. Expected on contributor
  PRs for UI / frontend changes (check the "UI / frontend change" box under
  *Type of change*) so reviewers can see the new behaviour without checking out
  the branch. Use `N/A` for non-visual changes.
- **Type of change** / **Test coverage** — check all that apply (at least one
  each).
- **Coverage notes** — required if you checked "Manual verification completed"
  or "Not applicable".

Generate the description from the actual diff and this session's context — lead
with the motivation, then the change. Don't pass a `--body` that skips these
sections.

## Code comments

Keep comments short and focused on the code, not on the change history.

- **Keep them brief** — prefer one or two lines. Avoid comments longer than
  three lines; if you need more, the code likely needs refactoring or a doc
  string, not a wall of inline commentary.
- **Describe the scenario, not the PR** — explain *what* the code handles or
  *why* it exists, in terms a future reader needs. Don't reference PR numbers,
  issue numbers, or ticket IDs (e.g. `#1646`, `fixes JIRA-123`); the scenario
  should be clear without chasing external links.
