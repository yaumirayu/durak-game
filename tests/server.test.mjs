import assert from 'node:assert/strict';
import {createEngine} from '../server/engine.mjs';
import {DurakRoom,verifyToken} from '../server/worker.mjs';
let matches=0;
for(let count=2;count<=6;count++)for(const size of [36,54])for(const variant of ['throw','transfer'])for(let repeat=0;repeat<5;repeat++){
 const e=createEngine();e.start(Array.from({length:count},(_,i)=>({name:'P'+i})),variant,size);
 for(let turn=0;turn<20000;turn++){
  const g=e.snapshot();
  const cards=[...g.deck,...g.players.flatMap(p=>p.hand),...g.table.flatMap(p=>p.d?[p.a,p.d]:[p.a])];
  assert.equal(cards.length,new Set(cards.map(c=>c.id)).size,'No duplicated cards');
  if(g.phase==='over')break;
  assert(g.current>=0&&g.current<count,'Turn is active');
  assert.equal(e.act((g.current+1)%count,'lead',g.players[g.current].hand[0]?.id),false);
  assert.equal(e.act(g.current,'lead','forged'),false);
  e.bot(g.current);
  if(turn===19999)assert.fail('Match did not terminate');
 }
 assert.equal(e.snapshot().phase,'over');matches++;
}
function object(){
 const records=new Map();
 const ctx={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v)),setAlarm:async()=>{},deleteAll:async()=>records.clear()}};
 return new DurakRoom(ctx,{});
}
const room=object();
async function call(who,action,data={}){
 const response=await room.fetch(new Request('https://internal/'+action,{method:'POST',headers:{'X-Player-Uid':who,'X-Room-Code':'ABCDEFGHJK'},body:JSON.stringify(data)}));
 return {status:response.status,value:await response.json()};
}
assert.equal((await call('owner','create',{name:'Owner',variant:'transfer',deckSize:54})).status,200);
assert.equal((await call('outsider','state')).status,403);
for(let i=1;i<6;i++)assert.equal((await call('p'+i,'join',{name:'Player '+i})).status,200);
assert.equal((await call('seventh','join',{name:'No room'})).status,409);
assert.equal((await call('p1','start')).status,403);
assert.equal((await call('owner','start')).status,200);
let state=(await call('owner','state')).value;
assert.equal(state.view.hand.length,6);
assert(!('deck' in state.view));
assert(state.view.players.every(p=>!('hand' in p)));
assert(!JSON.stringify(state).includes('"uid"'));
for(let i=1;i<6;i++){
 const guest=(await call('p'+i,'state')).value;
 assert.equal(guest.view.viewer,i);
 assert.equal(guest.view.hand.length,6);
 assert(!guest.organizer);
 assert(!('deck' in guest));
}
const actor=state.view.current,who=actor===0?'owner':'p'+actor;
const own=(await call(who,'state')).value;
const move={kind:'lead',cardId:own.view.hand[0].id,gameId:own.gameId,revision:own.revision};
assert.equal((await call(who,'move',{...move,revision:move.revision-1})).status,409);
assert.equal((await call(who,'move',{...move,cardId:'forged'})).status,409);
assert.equal((await call(who==='owner'?'p1':'owner','move',move)).status,409);
assert.equal((await call(who,'move',move)).status,200);
assert.equal((await call(who,'move',move)).status,429);
assert.equal((await call('owner','start')).status,409);
room.room.game.phase='over';
const beforeLeave=(await call('p1','state')).value.view.hand;
await call('owner','leave');
assert.deepEqual((await call('p1','state')).value.view.hand,beforeLeave,'Departed players cannot shift another identity onto a different hand');
await assert.rejects(()=>verifyToken('forged'));
console.log(`Passed ${matches} complete matches, card uniqueness, wrong turn/card, six-seat limit, owner/guest private views, unauthorized start/read, revision checks, replay and forged token rejection.`);
