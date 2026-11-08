// Generated from the shared game rules. No browser state or player secrets exported.

export function secureRandomInt(max){
 const limit=4294967296-4294967296%max;let n;
 do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);
 return n%max;
}
export function createEngine(snapshot=null){
 const R=['♣','♦','♥','♠'],F={11:'В',12:'Д',13:'К',14:'Т'};
 let g=snapshot,localRevealed=-1,transitioning=false,endingTimer,autoTimer;
 const mode='server',audio=()=>{},updateAll=()=>{},store=()=>{};
const joker=c=>c.s==='J';
const rank=c=>joker(c)?'ДЖ':F[c.r]||c.r;
const cardName=c=>joker(c)?
 (c.r===16?'Красный джокер':'Чёрный джокер'):
 rank(c)+c.s;
const trumps=(c,t)=>joker(c)||c.s===t;
const beats=(d,a,t)=>joker(d)?
 (!joker(a)||d.r>a.r):
 joker(a)?false:
 (d.s===a.s&&d.r>a.r)||(d.s===t&&a.s!==t);

const shuffle=a=>{
 for(let i=a.length-1;i>0;i--){
  const j=secureRandomInt(i+1);
  [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
};

function makeDeck(size){
 let cards=[];
 for(let s of R)
  for(let r=size===36?6:2;r<=14;r++)
   cards.push({id:s+r,s,r});
 if(size===54)
  cards.push({id:'J15',s:'J',r:15},{id:'J16',s:'J',r:16});
 return shuffle(cards);
}

function alive(){
 return g.players.map((p,i)=>p.hand.length?i:-1).filter(i=>i>=0);
}

function nextActive(from){
 for(let i=1;i<=g.players.length;i++){
  const n=(from+i)%g.players.length;
  if(g.players[n].hand.length)return n;
 }
 return from;
}

function orderAttackers(){
 let o=[];
 for(let i=0;i<g.players.length;i++){
  const n=(g.starter+i)%g.players.length;
  if(n!==g.defender&&g.players[n].hand.length)o.push(n);
 }
 return o;
}

function nextAttacker(from){
 const a=orderAttackers(),i=a.indexOf(from);
 return a[(i+1+a.length)%a.length];
}

function tableRanks(){
 return new Set(g.table.flatMap(p=>p.d?[p.a.r,p.d.r]:[p.a.r]));
}

function pending(){return g.table.find(p=>!p.d)}

function canTransfer(player,c){
 if(g.variant!=='transfer'||g.phase!=='defend'||
    player!==g.defender||!g.table.length||
    g.table.some(p=>p.d)||c.r!==g.table[0].a.r)
  return false;
 const n=nextActive(g.defender);
 return n!==g.defender&&
  g.table.length+1<=Math.min(g.round===1?5:6,g.players[n].hand.length);
}

function canThrow(c){
 return g.table.length<g.limit&&
 (g.table.length===0||tableRanks().has(c.r));
}

function removeCard(player,id){
 const a=g.players[player].hand,
 i=a.findIndex(c=>c.id===id);
 if(i<0)return null;
 return a.splice(i,1)[0];
}

function gameMessage(s){g.msg=s}

function startEngine(players,variant,deckSize,level){
 const deck=makeDeck(deckSize),hands=players.map(()=>[]);
 // Назначаем козырь до раздачи — это важно при шести игроках.
 if(deck[0].s==='J'){
  const idx=deck.findIndex(c=>c.s!=='J');
  [deck[0],deck[idx]]=[deck[idx],deck[0]];
 }
 const trump=deck[0].s;
 for(let k=0;k<6;k++)
  for(let i=0;i<players.length;i++)
   hands[i].push(deck.pop());
 let lowest=99,first=0;
 for(let i=0;i<players.length;i++)
  for(const c of hands[i])
   if(c.s===trump&&c.r<lowest){lowest=c.r;first=i}
 g={
  players:players.map((p,i)=>({
   name:p.name,bot:!!p.bot,hand:hands[i]
  })),
  deck,trump,variant,deckSize,level,table:[],
  starter:first,defender:0,current:first,phase:'lead',
  limit:6,first:true,round:0,passed:[],msg:'',
  winner:null,exited:[],outcome:'',
  roster:players.map(p=>({name:p.name,bot:!!p.bot}))
 };
 beginRound(first);
 localRevealed=-1;
 transitioning=false;
 updateAll();
}

function beginRound(start){
 if(g.phase==='over')return;
 const a=alive();
 if(a.length<=1){finishGame();return}
 g.starter=a.includes(start)?start:nextActive(start);
 g.defender=nextActive(g.starter);
 g.table=[];
 g.limit=Math.min(g.first?5:6,g.players[g.defender].hand.length);
 g.first=false;
 g.round++;
 g.phase='lead';
 g.current=g.starter;
 g.passed=[];
 gameMessage(g.players[g.current].name+' начинает раунд.');
}

function markPass(actor){
 if(!g.passed.includes(actor))g.passed.push(actor);
 let attackers=orderAttackers();
 if(g.table.length>=g.limit||
    attackers.every(a=>g.passed.includes(a))){
  endRound(g.phase==='takeToss');return;
 }
 g.current=nextAttacker(actor);
 skipUnableAttackers();
}

function skipUnableAttackers(){
 if(!['toss','takeToss'].includes(g.phase))return;
 let limit=g.players.length+1;
 while(limit-->0){
  if(g.table.length>=g.limit)
   return endRound(g.phase==='takeToss');
  const a=orderAttackers();
  if(!a.length||a.every(i=>g.passed.includes(i)))
   return endRound(g.phase==='takeToss');
  if(g.players[g.current].hand.some(canThrow))return;
  if(!g.passed.includes(g.current))g.passed.push(g.current);
  g.current=nextAttacker(g.current);
 }
}

function attackStage(taking){
 g.phase=taking?'takeToss':'toss';
 g.passed=[];
 let a=orderAttackers();
 if(!a.length||g.table.length>=g.limit)
  return endRound(taking);
 g.current=a[0];
 skipUnableAttackers();
}

function finishGame(){
 let remaining=alive();
 if(g.deck.length||remaining.length>1)return false;
 g.phase='over';
 g.winner=remaining[0]??null;
 if(mode!=='bot')audio(g.winner===null?'card':'win');
 g.outcome=remaining.length?
  g.players[g.winner].name+' остался(ась) с картами — дурак!':
  'Ничья: все вышли одновременно!';
 gameMessage(g.outcome);
 if(mode==='bot'){
  if(g.winner===0){
   stats.losses++;stats.streak=0;audio('lose');
  }else if(g.winner===null){
   stats.draws++;stats.streak=0;audio('card');
  }else{
   stats.wins++;stats.streak++;
   stats.bestStreak=Math.max(stats.bestStreak,stats.streak);
   audio('win');
  }
  store('durak6stats',stats);
 }
 return true;
}

function refillRound(){
 const order=[];
 for(let x=0;x<g.players.length;x++){
  const i=(g.starter+x)%g.players.length;
  if(i!==g.defender)order.push(i);
 }
 order.push(g.defender);
 for(const i of order)
  while(g.deck.length&&g.players[i].hand.length<6)
   g.players[i].hand.push(g.deck.pop());
}

function endRound(taken){
 const lastDef=g.defender;
 g.phase='transition';g.current=-1;
 gameMessage(taken?
  'Карты переходят защитнику…':
  'Бито! Карты уходят в отбой…');
 transitioning=true;
 updateAll();
 clearTimeout(endingTimer);
 (()=>{
  if(!g||g.phase!=='transition')return;
  if(taken)
   for(const p of g.table){
    g.players[lastDef].hand.push(p.a);
    if(p.d)g.players[lastDef].hand.push(p.d);
   }
  refillRound();
  g.table=[];
  if(!g.deck.length){
   for(let i=0;i<g.players.length;i++)
    if(g.players[i].hand.length===0&&!g.exited.includes(i))
     g.exited.push(i);
  }
  transitioning=false;
  if(!finishGame()){
   let n=taken?nextActive(lastDef):
    (g.players[lastDef].hand.length?lastDef:nextActive(lastDef));
   beginRound(n);
  }
  updateAll();
 })();
}

function tryMove(actor,kind,cardId){
 if(!g||g.phase==='over'||g.phase==='transition'||
    actor!==g.current)return false;
 let c=g.players[actor].hand.find(x=>x.id===cardId),ok=false;

 if(kind==='lead'&&g.phase==='lead'&&c){
  removeCard(actor,cardId);
  g.table.push({a:c,d:null});
  g.phase='defend';g.current=g.defender;
  gameMessage(g.players[g.defender].name+' защищается.');
  ok=true;
 }
 else if(kind==='defend'&&g.phase==='defend'&&c&&
         pending()&&beats(c,pending().a,g.trump)){
  pending().d=removeCard(actor,cardId);
  if(pending()){
   gameMessage('Нужно отбить остальные карты.');
  }else{
   attackStage(false);
   gameMessage('Карты отбиты. Можно подкинуть или сказать «Бито».');
  }
  ok=true;
 }
 else if(kind==='transfer'&&c&&canTransfer(actor,c)){
  const n=nextActive(g.defender);
  g.table.push({a:removeCard(actor,cardId),d:null});
  g.defender=n;
  g.limit=Math.min(g.round===1?5:6,g.players[n].hand.length);
  g.phase='defend';g.current=n;g.passed=[];
  gameMessage('Перевод на '+g.players[n].name+'!');
  ok=true;
 }
 else if(kind==='take'&&g.phase==='defend'){
  attackStage(true);
  gameMessage('Защитник берёт карты. Остальные могут подкинуть.');
  ok=true;
 }
 else if(kind==='toss'&&['toss','takeToss'].includes(g.phase)&&
         c&&canThrow(c)){
  const taking=g.phase==='takeToss';
  g.table.push({a:removeCard(actor,cardId),d:null});
  g.passed=[];
  if(taking){
   if(g.table.length>=g.limit)endRound(true);
   else{
    g.current=nextAttacker(actor);
    skipUnableAttackers();
   }
  }else{
   g.phase='defend';g.current=g.defender;
  }
  gameMessage(g.players[actor].name+' подкинул(а) '+cardName(c)+'.');
  ok=true;
 }
 else if(kind==='pass'&&['toss','takeToss'].includes(g.phase)){
  markPass(actor);ok=true;
 }
 if(ok){audio(kind==='take'?'take':'card');updateAll()}
 return ok;
}

function botChoice(actor){
 if(!g||g.current!==actor||
    g.phase==='transition'||g.phase==='over')return;
 let hand=g.players[actor].hand;
 const cost=c=>c.r+(trumps(c,g.trump)?
  (g.deck.length?30:10):0)+(joker(c)?40:0);
 const cheapest=a=>[...a].sort((x,y)=>cost(x)-cost(y))[0];
 let phase=g.phase;

 if(phase==='lead'){
  const c=cheapest(hand);
  if(c)tryMove(actor,'lead',c.id);
 }
 else if(phase==='defend'){
  let t=hand.filter(c=>canTransfer(actor,c)&&!trumps(c,g.trump));
  if(t.length&&g.level!=='easy'&&Math.random()<.70)
   return tryMove(actor,'transfer',cheapest(t).id);
  const p=pending(),opts=hand.filter(c=>beats(c,p.a,g.trump));
  if(!opts.length)return tryMove(actor,'take');
  let c=cheapest(opts);
  if(g.level==='hard'&&g.deck.length>7&&
     trumps(c,g.trump)&&!trumps(p.a,g.trump)&&
     c.r>11&&Math.random()<.55)return tryMove(actor,'take');
  if(g.level==='easy'&&Math.random()<.15)
   return tryMove(actor,'take');
  tryMove(actor,'defend',c.id);
 }
 else if(phase==='toss'||phase==='takeToss'){
  let opts=hand.filter(canThrow),
  nontrump=opts.filter(c=>!trumps(c,g.trump));
  let c=cheapest(nontrump.length?nontrump:opts);
  let rate=g.level==='easy'?.38:g.level==='hard'?.9:.67;
  if(c&&(g.phase==='takeToss'||Math.random()<rate)&&
     (nontrump.length||g.deck.length===0||g.level==='easy'))
   tryMove(actor,'toss',c.id);
  else tryMove(actor,'pass');
 }
}

function pumpBots(){
 clearTimeout(autoTimer);
 if(!g||g.phase==='over'||g.phase==='transition')return;
 if(g.current>=0&&g.players[g.current]?.bot){
  const token=g.round,seat=g.current;
  autoTimer=setTimeout(()=>{
   if(g&&g.current===seat&&g.round===token)
    botChoice(seat);
  },360);
 }
}

function publicView(seat){
 return {
  phase:g.phase,current:g.current,
  starter:g.starter,defender:g.defender,limit:g.limit,
  variant:g.variant,deckSize:g.deckSize,
  deckCount:g.deck.length,trump:g.trump,round:g.round,
  players:g.players.map((p,i)=>({
   name:p.name,bot:p.bot,count:p.hand.length,
   out:g.exited.includes(i)
  })),
  table:g.table,
  hand:seat>=0?g.players[seat]?.hand||[]:[],
  viewer:seat,msg:g.msg,winner:g.winner,
  outcome:g.outcome,passed:g.passed
 };
}


 return {
  start(players,variant,deckSize){startEngine(players,variant,deckSize,'normal')},
  act(actor,kind,id){return tryMove(actor,kind,id)},
  bot(actor){botChoice(actor)},
  view(seat){return structuredClone(publicView(seat))},
  snapshot(){return structuredClone(g)}
 };
}
