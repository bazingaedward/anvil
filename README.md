# Anvil

English | [简体中文](README.zh-CN.md)

**Keep coding when Claude Code—or your current model service—is no longer available.**

Anvil is an open-source desktop coding agent for macOS and Windows with replaceable model providers. If your Claude or another provider account is suspended, disabled, or unavailable, configure another working model API in Anvil and continue working with your local code, tools, and Git changes.

It includes an agent execution loop, tool approvals, persistent conversations, and a code review workspace. The desktop runtime currently uses OpenCode; Claude Code is a primary product benchmark.

### Continue with another provider

1. Obtain working API access. The current integration supports **HTTPS Responses APIs**; BytePlus Ark + DeepSeek has been tested. Other providers and models are not automatically verified.
2. Follow the [runtime setup](runtime/opencode/README.md) and launch Anvil with credentials injected through Keygrant.
3. Click the model name in the composer to configure a provider, model ID, Responses URL, and credential environment-variable name, then save and test the connection.
4. Attach your working folders, choose a permission mode, and continue coding. Folderless conversations are also supported.

Switching models inside Anvil reuses the conversation session. Anvil does not restore suspended accounts or make revoked keys work, and it does not automatically import another product's chat history or subscription allowance. API usage is billed by the selected provider.

**Our long-term goal is a model-agnostic coding harness that surpasses Claude on real-world coding tasks.** This is an ambition, not a demonstrated benchmark result; progress will be measured through reproducible evaluations.

## Desktop preview

The desktop preview includes:

- Local conversations with groups, pins, rename, archive/restore, and deletion; Ask, Auto, and Full access permission modes.
- Multiple working folders per conversation, with or without Git, and folderless chat.
- Configurable Responses API models, per-conversation selection, streaming replies, and cancellation.
- File/image attachments through a picker, drag-and-drop, or paste. UTF-8 text and common image formats are supported; images require a capable model. PDF and Office documents are not supported yet.
- A dedicated code review workspace with a fixed navigation rail, collapsible repository list, colored commit graph, branch filters, commit comparisons, and per-file diffs.
- Separate staged and working-tree diffs, Monaco editing with stale-save protection, and an on-demand interactive terminal.
- Google sign-in is required in the desktop app. Model profiles (without keys), default model and group definitions/order sync through Cloudflare Workers + D1. Stale saves require a refresh rather than silently overwriting another device.
- Chats, tasks, attachments and folder grants remain local, partitioned by account. The first login can import legacy local data. Inference still sends prompts and relevant context to the selected provider.

The avatar in the lower-left opens an account menu with account details, settings and sign out. Settings include sync, default model and signed-in devices; groups stay in the chat sidebar. API keys still come from local Keygrant injection. The independent `anvil-cloud` service runs at `https://anvil.keygrant.app`. See [account and sync](docs/account-sync.md).

BytePlus Ark Responses + DeepSeek is the first tested provider. macOS ARM64 live conversation, context, tool access, cancellation, and history restoration have been verified. The current Windows runtime has also passed a live text-attachment test. Custom models and image input depend on the configured provider's capabilities.

This is still a desktop preview. GitHub PR lists, comments, and merging are not integrated; stage, commit, and push through the terminal for now. See [code review](docs/code-review.md) and [composer/model details](docs/composer-and-models.md) (in Chinese).

Development requires Node.js 22.13+ and Git (the minimum includes unflagged `node:sqlite`). End users of packaged builds do not need Node.js or npm; Git and the project's development tools must be installed separately.

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

This separate internal CLI prototype is distinct from the desktop OpenCode runtime with verified live model calls described above. CLI tests use scripted model responses while exercising real files and test processes. Its live model execution and comparisons against Claude have not been validated; it has one provider adapter.

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
