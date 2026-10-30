import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This probe currently validates Windows x64 only.');
}
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const artifactRoot = path.join(repository, '.anvil', 'runtime-probes');
mkdirSync(artifactRoot, { recursive: true });
const runRoot = mkdtempSync(path.join(artifactRoot, 'run-'));
const executable = path.join(runRoot, 'anvil-runtime-probe.exe');
const bun = process.env.ANVIL_PROBE_BUN || path.join(directory, 'node_modules/@oven/bun-windows-x64/bin/bun.exe');
const source = process.env.ANVIL_PROBE_SOURCE || path.join(directory, 'host.mjs');
function run(command, args, options) {
  const child = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: 60_000, ...options });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Probe process failed: ${child.status ?? child.signal}`);
}
if (process.env.ANVIL_PROBE_EXECUTABLE) {
  copyFileSync(process.env.ANVIL_PROBE_EXECUTABLE, executable);
} else {
  const compiler = path.join(runRoot, 'bun.exe');
  copyFileSync(bun, compiler);
  run(compiler, ['build', '--compile', `--compile-executable-path=${compiler}`,
    '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig',
    source, '--outfile', executable], { cwd: directory });
}
const state = path.join(runRoot, 'state');
mkdirSync(state);
// Only supply OS essentials; don't inherit provider credentials or user OpenCode configuration.
const env = {};
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) {
  if (process.env[key]) env[key] = process.env[key];
}
for (const kind of ['DATA', 'CONFIG', 'CACHE', 'STATE']) {
  env[`XDG_${kind}_HOME`] = path.join(state, kind.toLowerCase());
}
env.OPENCODE_TEST_HOME = state;
for (const phase of ['create', 'restore']) {
  run(executable, [phase, state], { cwd: runRoot, env });
}
console.log(JSON.stringify({ result: 'passed', parent: process.versions.electron ? 'electron' : 'node', runRoot }));
