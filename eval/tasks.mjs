// Deterministic calibration tasks, not a public benchmark or model ranking.
const task = (id, category, prompt, files, solution, checks, extra = {}) => ({
  id,
  category,
  prompts: [prompt],
  files,
  solution,
  checks,
  ...extra,
});
export const tasks = [
  task(
    "sum",
    "bugfix",
    "Fix sum in src/sum.mjs. Handle empty arrays and negative numbers.",
    { "src/sum.mjs": "export const sum = xs => xs.reduce((a,b)=>a-b, 0);" },
    { "src/sum.mjs": "export const sum = xs => xs.reduce((a,b)=>a+b, 0);" },
    `const {sum}=await load('src/sum.mjs'); assert.equal(sum([]),0); assert.equal(sum([2,-1,5]),6);`,
  ),
  task(
    "pagination",
    "boundary",
    "Fix paginate(items,page,size) in src/page.mjs. Pages are 1-based; page and size must be positive integers, otherwise throw RangeError.",
    {
      "src/page.mjs":
        "export const paginate=(xs,page,size)=>xs.slice(page*size,(page+1)*size);",
    },
    {
      "src/page.mjs":
        "export function paginate(xs,page,size){if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1)throw new RangeError();return xs.slice((page-1)*size,page*size)}",
    },
    `const {paginate:p}=await load('src/page.mjs'); assert.deepEqual(p([1,2,3,4,5],2,2),[3,4]); assert.deepEqual(p([],1,2),[]);assert.deepEqual(p([1],3,2),[]);for(const args of [[0,2],[1,0],[1.5,2],[1,1.5]])assert.throws(()=>p([], ...args),RangeError);`,
  ),
  task(
    "money",
    "cross-file",
    "Fix checkout totals. Catalog prices are integer cents; public total(ids) returns dollars. Do not change catalog values.",
    {
      "src/catalog.mjs": "export const prices={book:1299,pen:250};",
      "src/checkout.mjs":
        "import {prices} from './catalog.mjs'; export const total=ids=>ids.reduce((n,id)=>n+prices[id],0);",
    },
    {
      "src/catalog.mjs": "export const prices={book:1299,pen:250};",
      "src/checkout.mjs":
        "import {prices} from './catalog.mjs'; export const total=ids=>ids.reduce((n,id)=>n+prices[id],0)/100;",
    },
    `const {prices}=await load('src/catalog.mjs');assert.deepEqual(prices,{book:1299,pen:250});const {total}=await load('src/checkout.mjs');assert.equal(total(['book','pen']),15.49);assert.equal(total([]),0);`,
  ),
  task(
    "csv",
    "parsing",
    "Implement parseRow in src/csv.mjs for one CSV row. Support quoted commas, doubled quote escapes, empty fields and trailing empty fields. Input is valid CSV without newlines.",
    { "src/csv.mjs": "export const parseRow=s=>s.split(',');" },
    {
      "src/csv.mjs": `export function parseRow(s){const out=[];let field='',q=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){field+='"';i++}else q=!q;}else if(c===','&&!q){out.push(field);field=''}else field+=c}out.push(field);return out}`,
    },
    `const {parseRow:p}=await load('src/csv.mjs');assert.deepEqual(p('a,"b,c",'),['a','b,c','']);assert.deepEqual(p('"a""b",x'),['a"b','x']);assert.deepEqual(p(''),['']);`,
  ),
  task(
    "retry",
    "async",
    "Fix retry(fn,attempts) in src/retry.mjs: await async failures, retry at most attempts times, return first success, rethrow last error. Reject attempts<1 with RangeError.",
    {
      "src/retry.mjs":
        "export async function retry(fn,attempts){try{return fn()}catch(e){return fn()}}",
    },
    {
      "src/retry.mjs":
        "export async function retry(fn,attempts){if(attempts<1)throw new RangeError();for(let i=0;i<attempts;i++){try{return await fn()}catch(e){if(i===attempts-1)throw e}}}",
    },
    `const {retry}=await load('src/retry.mjs');let n=0;assert.equal(await retry(async()=>{if(++n<3)throw Error('retry');return 7},3),7);assert.equal(n,3);n=0;const err=Error('last');await assert.rejects(retry(async()=>{n++;throw err},2),e=>e===err);assert.equal(n,2);await assert.rejects(retry(()=>1,0),RangeError);`,
  ),
  task(
    "merge",
    "immutability",
    "Fix mergeConfig(base,override): recursively merge plain objects, replace arrays, preserve other base fields and do not mutate either input. Inputs contain JSON values.",
    { "src/config.mjs": "export const mergeConfig=(a,b)=>Object.assign(a,b);" },
    {
      "src/config.mjs": `const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);export function mergeConfig(a,b){const out=structuredClone(a);for(const [k,v]of Object.entries(b))out[k]=obj(v)&&obj(a[k])?mergeConfig(a[k],v):structuredClone(v);return out}`,
    },
    `const {mergeConfig:m}=await load('src/config.mjs');const a={db:{host:'local',port:1},xs:[1]};const b={db:{port:2},xs:[2]};const r=m(a,b);assert.deepEqual(r,{db:{host:'local',port:2},xs:[2]});r.db.host='changed';r.xs.push(3);assert.equal(a.db.host,'local');assert.deepEqual(b.xs,[2]);`,
  ),
  task(
    "tests",
    "test-writing",
    "The slug function implements the intended contract. Add test/slug.test.mjs using node:test and node:assert/strict. Cover lowercase conversion, trimming/collapsing spaces to hyphens, and empty input. Do not change src/slug.mjs.",
    {
      "src/slug.mjs":
        "export const slug=s=>s.trim().toLowerCase().replace(/\\s+/g,'-');",
    },
    {
      "src/slug.mjs":
        "export const slug=s=>s.trim().toLowerCase().replace(/\\s+/g,'-');",
      "test/slug.test.mjs":
        "import {test} from 'node:test';import assert from 'node:assert/strict';import {slug} from '../src/slug.mjs';test('slug',()=>{assert.equal(slug(' HELLO  World '),'hello-world');assert.equal(slug(''),'')});",
    },
    "",
    { mutationTest: true },
  ),
  task(
    "repo-map",
    "repository-understanding",
    "Fix the public export from src/index.mjs: normalize must trim and lowercase emails. There are legacy and current implementations; keep legacy unchanged.",
    {
      "src/index.mjs": "export {normalize} from './legacy.mjs';",
      "src/legacy.mjs": "export const normalize=s=>s;",
      "src/email.mjs": "export const normalize=s=>s.trim().toLowerCase();",
    },
    {
      "src/index.mjs": "export {normalize} from './email.mjs';",
      "src/legacy.mjs": "export const normalize=s=>s;",
      "src/email.mjs": "export const normalize=s=>s.trim().toLowerCase();",
    },
    `const {normalize}=await load('src/index.mjs');assert.equal(normalize(' A@B.COM '),'a@b.com');const legacy=await load('src/legacy.mjs');assert.equal(legacy.normalize(' A '),' A ');`,
  ),
  task(
    "multi-directory",
    "cross-directory",
    "Fix apps/web/total.mjs to calculate total item quantity using packages/cart/count.mjs. Correct the shared count implementation; preserve the public total API.",
    {
      "packages/cart/count.mjs": "export const count=items=>items.length;",
      "apps/web/total.mjs":
        "import {count} from '../../packages/cart/count.mjs';export const total=items=>count(items);",
    },
    {
      "packages/cart/count.mjs":
        "export const count=items=>items.reduce((n,x)=>n+x.quantity,0);",
      "apps/web/total.mjs":
        "import {count} from '../../packages/cart/count.mjs';export const total=items=>count(items);",
    },
    `const {total}=await load('apps/web/total.mjs');const {count}=await load('packages/cart/count.mjs');assert.equal(total([{quantity:2},{quantity:3}]),5);assert.equal(count([]),0);assert.equal(count([{quantity:4}]),4);`,
  ),
  task(
    "resume",
    "multi-turn",
    "Implement formatName(name) in src/name.mjs: trim and uppercase. Preserve this uppercase requirement in later changes.",
    { "src/name.mjs": "export const formatName=name=>name;" },
    {
      "src/name.mjs":
        "export const formatName=(name,prefix='')=>prefix+name.trim().toUpperCase();",
    },
    `const {formatName:f}=await load('src/name.mjs');assert.equal(f(' alice '),'ALICE');assert.equal(f(' bob ','Hi '),'Hi BOB');`,
    {
      prompts: [
        "Implement formatName(name) in src/name.mjs: trim and uppercase. Preserve this uppercase requirement in later changes.",
        "Extend the function with an optional prefix argument, default empty. Preserve the previously requested normalization behavior.",
      ],
    },
  ),
];
