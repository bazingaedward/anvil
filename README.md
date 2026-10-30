# Anvil

English | [简体中文](README.zh-CN.md)

An open-source, model-agnostic coding harness with a desktop workspace for macOS and Windows.

**Our long-term goal is to build a model-agnostic coding harness that surpasses Claude on real-world coding tasks.** Claude Code is our primary product benchmark. Progress toward this goal will be measured through reproducible evaluations.

Models change. Anvil focuses on the execution loop around them: understanding a repository, choosing tools, making precise edits, running checks, and repairing failures.

## Desktop preview

The first desktop milestone provides a local workspace for reviewing and editing code:

- Open a Git repository and browse its files.
- Edit UTF-8 text with Monaco; reject stale saves and protect unsaved edits.
- Review working-tree and staged diffs separately, including new, deleted, and renamed files.
- Run an interactive terminal in the repository using xterm.js and node-pty.
- Resize the sidebar and terminal; restore the last repository on launch.

The desktop **does not run the agent yet**. Agent integration is next; the core investment is the harness, not a full Git client. Stage, commit, and push through the terminal for now. There is no Git Graph, plugin marketplace, or separate browser product.

Development requires Node.js 22.12+ and Git. End users of packaged builds do not need Node.js or npm; Git and the project's development tools must be installed separately.

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run package:mac   # on macOS
npm run package:win   # on Windows
```

Native terminal dependencies are rebuilt for Electron during installation; source builds may need Xcode Command Line Tools on macOS or Visual Studio C++ build tools on Windows. The preview reads text files up to 2 MiB and does not open symlink targets or binary files. The terminal runs with your user permissions, not in a sandbox. Installer signing and automatic updates are not configured yet.

## Internal harness prototype

- A local CLI with a provider-independent execution loop and an initial OpenAI Responses API adapter.
- File listing, literal text search, file reading, exact text replacement, new file creation, and command execution.
- Interactive approval for edits and model-requested commands. Non-interactive runs deny those operations.
- A user-supplied acceptance check: failures return to the model for repair; no check means the result is **unverified**.
- Bounded model turns, context size, file size, command output, and execution time.
- File-tool path checks and stale-read detection to reduce accidental overwrites.

This is an early prototype. Local tests use scripted model responses while exercising real files and test processes. Live model execution and comparisons against Claude have not been validated. Only one real provider adapter exists so far.

## Run the internal harness

Requirements: Node.js 22+, ripgrep (`rg`), and an OpenAI API key stored in keygrant under `OPENAI_API_KEY`. API-key requests use separately billed API access; they do not consume ChatGPT subscription allowance.

```sh
npm ci
npm test
npm run anvil -- --help
```

Run from an interactive terminal, replacing the repository path and model ID with your own:

```sh
keygrant exec --redact OPENAI_API_KEY -- npm run anvil -- \
  --repo /path/to/repository \
  --model MODEL_ID \
  --check 'npm test' \
  'Fix the failing test with the smallest relevant change.'
```

Anvil shows each proposed edit or command and asks for approval. The command supplied through `--check` is already authorized and may run repeatedly. A passing check produces `completed`; no check produces `unverified` (exit code 2). A denied operation stops the run. Other failures, cancellation, or limits produce exit code 1. Review the resulting diff before committing.

This is a local executor, **not a sandbox**. Approved commands run with your user permissions. File tools reject traversal, symlinks, and selected sensitive paths, but those checks do not constrain shell commands. Commands receive a reduced environment without the model API key. No conversation transcript is saved by default.

## Design and evaluation

See the [design document](docs/design.md) (in Chinese) for module boundaries, implementation decisions, and acceptance criteria.

Future Claude comparisons should use the same tasks, starting repositories, environments, permissions, and budgets, with model and product versions recorded. Measure success rate, elapsed time, cost, and human intervention across repeated runs.

## ChatGPT subscription experiment

The separate OAuth smoke test is paused after account/workspace permission failures. It has not completed a real inference request and is not the CLI's authentication path. See the [test guide and findings](docs/chatgpt-smoke-test.md) (in Chinese).

## License

[MIT License](LICENSE).
