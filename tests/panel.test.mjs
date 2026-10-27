import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const model = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../applet/files/mintcodexbar@jaron/panelModel.js', import.meta.url), 'utf8'), model);
const accounts = [
 {id:'one', windows:[{label:'Session · 5h', remaining:70},{label:'Weekly', remaining:90}]},
 {id:'two', windows:[{label:'Session · 5h', remaining:50},{label:'Weekly', remaining:20}]},
];
test('session and weekly limits are summed separately across counted accounts', () => {
 const all = model.summarize(accounts, []);
 assert.equal(all.session, 120);
 assert.equal(all.weekly, 110);
 const one = model.summarize(accounts, ['two']);
 assert.equal(one.session, 70);
 assert.equal(one.weekly, 90);
 assert.equal(model.summarize(accounts, ['one','two']).session, null);
});
test('weekly-only accounts do not inflate the session total', () => {
 const r = model.summarize([...accounts, {id:'w', windows:[{label:'Weekly', remaining:40}]}], []);
 assert.equal(r.session, 120);
 assert.equal(r.weekly, 150);
});
test('missing and disabled accounts do not masquerade as quota', () => {
 const r = model.summarize([...accounts,{id:'bad',error:'offline',windows:[]},{id:'disabled',disabled:true,windows:[{label:'Weekly',remaining:100}]}],['two']);
 assert.equal(r.weekly, 90);
 assert.equal(r.missing, 1);
 assert.equal(r.counted.length, 2);
});
test('new accounts are counted by default', () => {
 assert.equal(model.summarize([...accounts,{id:'new',windows:[{label:'Weekly',remaining:10}]}],['two']).weekly, 100);
});
test('saved order wins and new accounts are appended in discovery order', () => {
 const list = [{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
 assert.deepEqual(Array.from(model.orderAccounts(list, ['c','gone','a']), a => a.id), ['c','a','b','d']);
 assert.deepEqual(Array.from(model.orderAccounts(list, []), a => a.id), ['a','b','c','d']);
});
test('even usage marker is the share of the window still ahead', () => {
 const now = Date.parse('2026-01-01T00:00:00Z');
 const w = {resetsAt:'2026-01-01T00:26:00Z', windowSeconds:18000};
 assert.equal(Math.round(model.evenRemaining(w, now) * 10) / 10, 8.7);
 assert.equal(model.evenRemaining({resetsAt:'2026-01-01T00:26:00Z'}, now), null);
 assert.equal(model.evenRemaining({resetsAt:'2025-12-31T00:00:00Z', windowSeconds:3600}, now), 0);
});
