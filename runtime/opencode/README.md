# Anvil agent runtime preview

Windows x64 only. The desktop owns task IDs, history and IPC. This adapter alone
imports OpenCode 2.0.0; it compiles with Bun 1.4.2 into a standalone executable.
The executable is included in Windows desktop packages. macOS retains the editor
and terminal preview; agent packaging there is not implemented yet.

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
The current provider adapter uses a BytePlus Ark HTTPS `/responses` URL and
`deepseek-v4-1-flash-261017`.

The runtime removes the credential variables before initializing OpenCode and
launching tools. Credentials remain in memory for provider requests. Project
OpenCode configuration is disabled. SDK state is isolated under the desktop's
user-data directory. Conversations are independent of working folders; Anvil stores task history there
and reuses the SDK session to retain context across turns and restarts.

All SDK tool actions request approval; the UI offers Deny and Allow once.
Cancellation interrupts the session, with a five-second process-kill fallback.
Closing the desktop stops the active task. Switching the file browser between working folders keeps conversations and active tasks running. A task
marked completed means its configured acceptance command passed. Without an
acceptance command, a model finish is recorded as unverified. This executor is
not an OS sandbox; approved tools run with the user's filesystem permissions.
Configurable model selection and cross-platform runtime packaging remain follow-up work.

Expand **Add acceptance check** above the composer to specify a command and one
of the added working folders. Sending the message authorizes that command to run
after each model round. Failure output is returned to the same SDK session for
repair; the command and directory remain fixed for the task. The default allows
two repairs, 120 seconds per check, and 15 minutes for the whole task. Exhausting
the repair or time budget records a limit, not a successful completion. Denying a
tool request stops the task without another repair attempt.

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
