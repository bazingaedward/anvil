import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Agent} from '../../desktop/main/agent';
import {runAcceptance} from '../../desktop/main/acceptance';
import type {AcceptanceOptions} from '../../desktop/shared/api';

const credentials={BYTEPLUS_ARK_API_KEY:'fixture-secret',BYTEPLUS_ARK_RESPONSES_URL:'https://example.invalid/responses'};
const waitFor=async(fn:()=>boolean)=>{for(let i=0;i<240;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Timed out waiting for task');};
function fixture(t:{after:(fn:()=>Promise<void>)=>void},mode='repair',budget?:number){
 const root=mkdtempSync(path.join(os.tmpdir(),'anvil-accept-'));
 const worker=path.join(root,'worker.cjs'),check=path.join(root,'check.cjs');
 writeFileSync(worker,`const fs=require('node:fs');const path=require('node:path');const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type!=='start')return;fs.appendFileSync(path.join(m.repo,'inputs.jsonl'),JSON.stringify(m)+'\\n');send({type:'session',id:m.sessionID||'ses-fixture'});if('${mode}'==='hang')return;const repaired=m.text.includes('acceptance check failed');if(repaired&&'${mode}'==='repair')fs.writeFileSync(path.join(m.repo,'value.txt'),'fixed');send({type:'text',text:repaired?'Repaired':'Done'});send({type:'done',status:'completed'});process.exit(0);});`);
 writeFileSync(check,`const fs=require('node:fs');const good=fs.existsSync('value.txt')&&fs.readFileSync('value.txt','utf8')==='fixed';console.log(good?'PASS':'EXPECTED_FIXED_VALUE');process.exit(good?0:1);`);
 const agent=new Agent(root,path.join(root,'state'),process.execPath,()=>{},credentials,[worker],budget);
 const options:AcceptanceOptions={command:`"${process.execPath}" "${check}"`,directory:root,maxRepairs:2,timeoutMs:3000};
 t.after(async()=>{agent.stop();await new Promise(resolve=>setTimeout(resolve,150));rmSync(root,{recursive:true,force:true});});
 return {root,agent,options};
}

test('failed real acceptance command feeds repair evidence into the same session, then passes',async t=>{
 const {root,agent,options}=fixture(t);
 agent.start('chat','Fix value',[root],root,options);
 await waitFor(()=>agent.list()[0].status!=='running');
 const result=agent.list()[0];
 assert.equal(result.status,'completed');
 assert.deepEqual(result.checks?.map(check=>check.exitCode),[1,0]);
 const inputs=readFileSync(path.join(root,'inputs.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(inputs.length,2);assert.equal(inputs[1].sessionID,'ses-fixture');
 assert.match(inputs[1].text,/EXPECTED_FIXED_VALUE/);
 assert.equal(result.acceptance?.command,options.command);
 const restored=new Agent(root,path.join(root,'state'),process.execPath,()=>{},credentials);
 assert.deepEqual(restored.list()[0].checks,result.checks);assert.equal(restored.list()[0].status,'completed');
});

test('model completion cannot bypass a failing check and repair budget is bounded',async t=>{
 const {root,agent,options}=fixture(t,'no-repair');
 agent.start('chat','Pretend success',[root],root,{...options,maxRepairs:1});
 await waitFor(()=>agent.list()[0].status!=='running');
 assert.equal(agent.list()[0].status,'limit');
 assert.deepEqual(agent.list()[0].checks?.map(check=>check.exitCode),[1,1]);
 assert.equal(readFileSync(path.join(root,'inputs.jsonl'),'utf8').trim().split('\n').length,2);
});

test('a task without a check is unverified and invalid checks never start',async t=>{
 const {root,agent,options}=fixture(t);
 assert.throws(()=>agent.start('chat','Task',[root],root,{...options,directory:path.dirname(root)}),/Invalid acceptance/);
 assert.throws(()=>agent.start('chat','Task',[root],root,{...options,maxRepairs:6}),/Invalid acceptance/);
 assert.equal(agent.list().length,0);
 agent.start('chat','No check');await waitFor(()=>agent.list()[0].status!=='running');
 assert.equal(agent.list()[0].status,'unverified');assert.deepEqual(agent.list()[0].checks,[]);
});

test('cancelling a running acceptance command kills its descendant and starts no repair',async t=>{
 const {root,agent,options}=fixture(t);
 const script=path.join(root,'hang.cjs'),pidFile=path.join(root,'pid.txt');
 writeFileSync(script,`require('node:fs').writeFileSync('pid.txt',String(process.pid));setInterval(()=>{},1000);`);
 const task=agent.start('chat','Run test',[root],root,{...options,command:`"${process.execPath}" "${script}"`,timeoutMs:10000});
 await waitFor(()=>existsSync(pidFile));
 const pid=Number(readFileSync(pidFile,'utf8'));
 agent.cancel(task.id);await waitFor(()=>agent.list()[0].status!=='running');
 assert.equal(agent.list()[0].status,'cancelled');assert.equal(agent.list()[0].checks?.[0].cancelled,true);
 await waitFor(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
 assert.equal(readFileSync(path.join(root,'inputs.jsonl'),'utf8').trim().split('\n').length,1);
});

test('task deadline stops a hung model without claiming completion',async t=>{
 const {agent}=fixture(t,'hang',100);
 agent.start('chat','Wait');await waitFor(()=>agent.list()[0].status!=='running');
 assert.equal(agent.list()[0].status,'limit');assert.match(agent.list()[0].error||'',/time limit/);
});

test('acceptance captures bounded output, uses selected cwd, and omits arbitrary parent secrets',async t=>{
 const {root,options}=fixture(t);
 const script=path.join(root,'output.cjs');
 writeFileSync(script,`if(process.env.ANVIL_TEST_PRIVATE||process.env.BYTEPLUS_ARK_API_KEY)process.exit(2);console.log(process.cwd());console.log('x'.repeat(100000));`);
 process.env.ANVIL_TEST_PRIVATE='not-in-child';
 try{
  const result=await runAcceptance({...options,command:`"${process.execPath}" "${script}"`},1,new AbortController().signal);
  assert.equal(result.exitCode,0);assert.equal(result.truncated,true);assert.ok(result.output.startsWith(root));assert.ok(Buffer.byteLength(result.output)<=65536);
 }finally{delete process.env.ANVIL_TEST_PRIVATE;}
});

test('check timeout is recorded and the command is terminated',async t=>{
 const {root,options}=fixture(t);
 const script=path.join(root,'timeout.cjs');writeFileSync(script,'setInterval(()=>{},1000);');
 const result=await runAcceptance({...options,command:`"${process.execPath}" "${script}"`,timeoutMs:100},1,new AbortController().signal);
 assert.equal(result.timedOut,true);assert.equal(result.cancelled,false);
});
