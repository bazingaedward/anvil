import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const snapshotRevision = "702ba5b";
const git = (...args) =>
  execFileSync(
    "git",
    ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
const names = git(
  "ls-tree",
  "-r",
  "--name-only",
  snapshotRevision,
  "src",
  "test/harness.test.mjs",
)
  .trim()
  .split("\n");
const source = Object.fromEntries(
  names.map((name) => [name, git("show", `${snapshotRevision}:${name}`)]),
);
const solution = Object.fromEntries(
  Object.entries(source).filter(([name]) => name.startsWith("src/")),
);
function regression(id, prompt, changes, checks) {
  const files = {
    ...source,
    "package.json": JSON.stringify({
      type: "module",
      scripts: { test: "node --test test/harness.test.mjs" },
    }),
    "README.md":
      "Anvil CLI source snapshot. Node.js built-ins only. Fix the reported regression without weakening tests. Some process/shell tests target POSIX; use focused node:test name patterns on Windows. No dependency installation is needed.",
  };
  for (const [file, before, after] of changes) {
    if (!files[file].includes(before)) throw Error(`Stale mutation: ${id}`);
    files[file] = files[file].replace(before, after);
  }
  return {
    id,
    category: "repository-regression",
    snapshotRevision,
    prompts: [prompt],
    files,
    solution,
    checks,
  };
}
export const repoTasks = [
  regression(
    "repo-edit-integrity",
    "Users report that approved edits sometimes overwrite changes made while the approval dialog was open. Literal replacement strings containing $& also produce unexpected content. Fix both regressions in the file-editing pipeline while preserving read-before-edit, unique-match and create-file protections.",
    [
      [
        "src/tools.mjs",
        "current.replace(args.old_text, () => args.new_text)",
        "current.replace(args.old_text, args.new_text)",
      ],
      [
        "src/tools.mjs",
        'if (name === "edit_file" && hash(await read(target)) !== expected)',
        "if (false)",
      ],
    ],
    `const fs=await import('node:fs/promises');const {createTools}=await load('src/tools.mjs');const root=process.cwd();await fs.writeFile('sample.txt','old');let calls=0;const tools=await createTools({root,approve:async()=>{calls++;return true}});const edit={path:'sample.txt',old_text:'old',new_text:'$& literal'};assert.ok((await tools.execute('edit_file',edit)).error);assert.equal(calls,0);await tools.execute('read_file',{path:'sample.txt'});assert.ok(!(await tools.execute('edit_file',edit)).error);assert.equal(await fs.readFile('sample.txt','utf8'),'$& literal');const concurrent=await createTools({root,approve:async()=>{await fs.writeFile('sample.txt','external');return true}});await concurrent.execute('read_file',{path:'sample.txt'});assert.ok((await concurrent.execute('edit_file',{...edit,old_text:'$& literal'})).error);assert.equal(await fs.readFile('sample.txt','utf8'),'external');assert.ok((await tools.execute('create_file',{path:'sample.txt',content:'overwrite'})).error);assert.equal(await fs.readFile('sample.txt','utf8'),'external');`,
  ),
  regression(
    "repo-task-outcomes",
    "The harness sometimes marks an interrupted or truncated acceptance check as completed, and an interrupted tool can be followed by another tool call. Fix the outcome propagation across the execution loop and process-result predicate. Keep normal successful checks and failed-check repair behavior intact.",
    [
      [
        "src/process.mjs",
        "&& !result.timedOut && !result.truncated && !result.cancelled && !result.spawnError",
        "&& !result.spawnError",
      ],
      [
        "src/agent.mjs",
        'if (result.cancelled) return finish("cancelled", "Task interrupted.");',
        'if (false) return finish("cancelled", "Task interrupted.");',
      ],
    ],
    `const {commandPassed}=await load('src/process.mjs');assert.equal(commandPassed({exitCode:0}),true);for(const flag of ['timedOut','truncated','cancelled','spawnError'])assert.equal(commandPassed({exitCode:0,[flag]:true}),false,flag);const {runAgent}=await load('src/agent.mjs');let calls=0;const tools={changed:new Set(),definitions:[],execute:async()=>{calls++;return {cancelled:true}}};let r=await runAgent({task:'x',tools,maxTurns:2,provider:{next:async()=>({text:'',calls:[{id:'1',name:'a',arguments:{}},{id:'2',name:'b',arguments:{}}]})}});assert.equal(r.status,'cancelled');assert.equal(calls,1);let checks=0;let turns=0;r=await runAgent({task:'x',tools,maxTurns:3,provider:{next:async()=>{turns++;return {text:'done',calls:[]}}},verify:async()=>({exitCode:++checks===1?1:0})});assert.equal(r.status,'completed');assert.equal(turns,2);`,
  ),
  regression(
    "repo-provider-history",
    "After a tool call, subsequent Responses requests lose reasoning state and tool-call continuity. Also, an incomplete response is mistakenly accepted as complete. Repair the provider adapter while preserving tool result IDs, text extraction and malformed-arguments handling. Use a mocked fetch; no real API calls are needed.",
    [
      [
        "src/openai.mjs",
        'if (message.role === "assistant") return message.state;',
        'if (message.role === "assistant") return [{role:"assistant",content:message.content}];',
      ],
      [
        "src/openai.mjs",
        'data.status !== "completed" || !Array.isArray(data.output)',
        "!Array.isArray(data.output)",
      ],
    ],
    `const {createOpenAIProvider}=await load('src/openai.mjs');const output=[{type:'reasoning',id:'r',encrypted_content:'opaque'},{type:'function_call',id:'fc',call_id:'call-1',name:'read_file',arguments:'{"path":"a"}'},{type:'message',content:[{type:'output_text',text:'hello'}]}];let sent;const p=createOpenAIProvider({apiKey:'test',model:'fake',fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output})}}});const first=await p.next({instructions:'rules',messages:[{role:'user',content:'task'}],tools:[]});assert.equal(first.text,'hello');assert.equal(first.calls[0].id,'call-1');await p.next({instructions:'rules',messages:[{role:'user',content:'task'},{role:'assistant',content:first.text,state:first.state},{role:'tool',callId:'call-1',content:'result'}],tools:[]});assert.deepEqual(sent.input.slice(1,4),output);assert.deepEqual(sent.input[4],{type:'function_call_output',call_id:'call-1',output:'result'});const bad=createOpenAIProvider({apiKey:'test',model:'fake',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete',output})})});await assert.rejects(bad.next({messages:[],tools:[]}));`,
  ),
];
