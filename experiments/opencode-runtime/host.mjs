import { OpenCode } from '@opencode/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [mode, root] = process.argv.slice(2);
assert.ok(root);
const host = await OpenCode.create({
 app:{name:'anvil-runtime-probe',version:'0.0.0'},
 database:{path:path.join(root,'sessions.db')},
 models:{fetch:false},config:{directory:path.join(root,'config'),project:false},
 fs:{filewatcher:false,fff:false}
});
try {
 assert.equal((await host.health.get()).healthy,true);
 if(mode==='create') {
  const session=await host.sessions.create({location:{directory:root},metadata:{probe:'anvil'}});
  await writeFile(path.join(root,'session.json'),JSON.stringify({id:session.id}));
  console.log(JSON.stringify({stage:'created',id:session.id}));
 } else {
  const {id}=JSON.parse(await readFile(path.join(root,'session.json'),'utf8'));
  const session=await host.sessions.get({sessionID:id});
  assert.equal(session.id,id);
  assert.equal(session.metadata.probe,'anvil');
  console.log(JSON.stringify({stage:'restored',id}));
 }
} finally { await host.close(); }
