# Anvil agent runtime preview

Supports builds on macOS ARM64/x64 and Windows x64. The desktop owns task IDs, history and IPC. This adapter alone
imports OpenCode 2.0.0; it compiles with Bun 1.4.2 into a standalone executable.
The executable is included in desktop packages: `anvil-runtime` on macOS and
`anvil-runtime.exe` on Windows. Build on the target OS and architecture.
macOS also includes the upstream `opencode-pty` helper beside the runtime. A local
build-time module mapping resolves that helper without changing the upstream SDK.

From the repository root:

```powershell
npm ci --ignore-scripts --prefix runtime/opencode
npm run runtime:build
npm run build
keygrant exec --redact BYTEPLUS_ARK_API_KEY,BYTEPLUS_ARK_RESPONSES_URL -- npm run preview
```

With the keygrant MCP integration, use `exec_with_secrets` with the same two
secret names and `npm run preview` as the command. The credentials must be
available when the desktop starts. Do not write them into project configuration.
The default configuration uses a BytePlus Ark HTTPS `/responses` URL and
`deepseek-v4-1-flash-261017`. The composer model menu can add and select other
HTTPS Responses, Chat Completions, Anthropic Messages and Google Gemini configurations. Store the API key in Keygrant and enter its
environment-variable name, not the key, in model settings. New credential names
require restarting Anvil with those secrets injected. Existing Anvil sessions
are reused when switching models. See [model and attachment details](../../docs/composer-and-models.md).

For an existing vault entry named `DEEPSEEK_API_KEY` that holds a **BytePlus** key,
use `exec_with_secrets` with that name and this macOS command (the mapping stays
in the process environment):

```sh
BYTEPLUS_ARK_API_KEY="$DEEPSEEK_API_KEY" BYTEPLUS_ARK_RESPONSES_URL=https://ark.ap-southeast.bytepluses.com/api/v3/responses npm run dev
```

A key issued by the official DeepSeek API is not interchangeable with a BytePlus key.

Verified on macOS ARM64 (2026-11-04): compiled runtime, a live folderless reply,
context retained after attaching a folder, reading its file, permission/cancel,
and history after restarting Electron. Intel macOS and signed installers have
not been tested in this run.

The runtime removes the credential variables before initializing OpenCode and
launching tools. Credentials remain in memory for provider requests. Project
OpenCode configuration is disabled. SDK state is isolated under the desktop's
user-data directory. Conversations are independent of working folders; Anvil stores task history there
and reuses the SDK session to retain context across turns and restarts.

SDK tool actions are evaluated against the conversation permission mode. Ask allows scoped reads and asks for edits/commands; Auto also allows scoped edits, while commands and unknown operations require approval. Full access approves tool requests without per-operation prompts. These are application permission policies, not an OS sandbox.
Cancellation interrupts the session, with a five-second process-kill fallback.
Closing the desktop stops the active task. Switching the file browser between working folders keeps conversations and active tasks running. A task
marked completed means its configured acceptance command passed. Without an
acceptance command, a model finish is recorded as unverified. This executor is
not an OS sandbox; approved tools run with the user's filesystem permissions.
Configurable model selection is available; signed releases remain follow-up work.

The internal task API still supports an optional acceptance command, but the
composer no longer exposes Advanced task settings. Without a configured check,
a model finish is recorded as unverified. For API-created checks, failure output
returns to the same SDK session for repair; the command and directory remain
fixed for the task. Repair and time budgets bound execution, and denying a tool
request stops the task without another repair attempt.

Check output is capped at 64 KiB per run. Checks receive a minimal OS environment
without provider credentials; cancellation and check timeouts terminate their
process tree. Check results are stored with task history. The agent may edit
project files with approval, so passing a command is evidence of that command's
result, not a guarantee that project test files remained unchanged.

Validation (real tests incur provider usage):

```powershell
npm run typecheck
npm run test:desktop
npm run build
# Execute through keygrant MCP with both secrets:
# node --import tsx experiments/opencode-runtime/integration-probe.ts
# node --import tsx experiments/opencode-runtime/acceptance-probe.ts
# set ANVIL_REAL_AGENT=1&& node node_modules/@playwright/test/cli.js test test/e2e/agent.spec.ts
```

Add one or more working folders through the directory picker. Ordinary folders are supported without Git. Each turn receives the current folder list; existing conversations retain their execution directory and can access the other selected folders by absolute path. Selecting a subfolder never widens the editor scope to its parent Git repository. Git review is available when the selected folder itself is a repository root. Directory selection supplies task context; it does not silently approve tool operations or provide an OS sandbox. Legacy per-repository task history is imported when that folder is selected.

The ordinary E2E suite skips the live-model test. It is opt-in and uses a temporary
repository and desktop profile. The integration probe leaves its isolated state
in the ignored `.anvil/integration-probes` directory for debugging.

## Local conversation management

The main process owns `userData/tasks/conversations.sqlite`, using Electron's
built-in `node:sqlite`. The database contains conversation metadata, drafts,
acceptance settings, the selected conversation, and ordered task records (user
prompts, assistant messages, verification results and private SDK session links).
Only public task fields cross IPC. SDK runtime databases remain separate.

Each sidebar conversation has a trailing actions menu for inline rename, archive/restore and delete. Actions target that row without switching the open conversation.
The sidebar no longer has a conversation search field. History can be browsed
and drafts written without selecting a folder.
Sending requires an installed runtime and provider credentials. Folders are
optional; a conversation without folders uses a private internal working
directory and gains no folder grants. See [optional folders](../../docs/optional-conversation-folders.md).
Archived conversations must be restored before sending. Running conversations
cannot be archived; deletion asks for confirmation and waits for cancellation
of the model or acceptance command before removing the conversation and tasks.
Project files are never deleted by conversation management.

On first use, the global task JSON is imported transactionally. Legacy per-folder
task JSON is imported when that folder is selected; its original SDK session path
is retained. Renderer drafts are imported once through IPC. Migration markers
and deleted-ID tombstones prevent old files from restoring deleted conversations.
Malformed imports roll back and keep the source available for recovery.

Original JSON/localStorage backups and SDK databases are retained. Delete removes
Anvil's current history and session links, not these recovery copies or provider
records; it is not a secure-erasure operation. New versions write only SQLite
conversation data. Do not run an older preview against the same profile after
migration: changes it writes to legacy storage are not imported again.

Folder access is granted per conversation through the local directory picker and a
native confirmation. Selected editor folders from older versions are not grants.
The composer shows authorized folders with revoke buttons; revoking a folder stops
that conversation's running task before removing access. Shell commands, unknown
actions, wildcard paths and paths through symlinks still require approval. This is
a tool approval policy, not OS sandboxing; approved shell commands may access other
resources. SQLite schema v2 stores grants separately from editable draft metadata.

Permission modes (2026-11-03): Ask allows scoped reads only; Auto additionally allows scoped explicit edits and asks for commands/unknown operations; Full access allows all runtime permission requests after native confirmation. Modes are per conversation and cannot change during a running task. This policy is not an OS sandbox. The composer no longer submits legacy acceptance commands; request testing as part of the task.

Provider adapters and capability configuration are documented in [model providers](../../docs/model-providers.md). Connection probes now use the same runtime, with tool requests denied and temporary sessions removed.
