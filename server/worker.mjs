import {createEngine} from './engine.mjs';

const PROJECT='durak-game-74db6';
const ORIGINS=new Set(['https://yaumirayu.github.io','http://127.0.0.1:8765']);
let keyCache={until:0,keys:[]};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
function bytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
export async function verifyToken(token){
 if(typeof token!=='string'||token.length>8192)throw new Error('Authentication required');
 const parts=token.split('.');if(parts.length!==3)throw new Error('Invalid token');
 const h=JSON.parse(new TextDecoder().decode(bytes(parts[0]))),p=JSON.parse(new TextDecoder().decode(bytes(parts[1])));
 const now=Date.now()/1000;
 if(h.alg!=='RS256'||typeof h.kid!=='string'||p.aud!==PROJECT||p.iss!=='https://securetoken.google.com/'+PROJECT||typeof p.sub!=='string'||!p.sub||p.sub.length>128||!(p.exp>now)||!(p.iat<=now+30)||!(p.auth_time<=now+30))throw new Error('Invalid token');
 if(keyCache.until<Date.now()){
  const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if(!r.ok)throw new Error('Unable to verify token');
  keyCache={until:Date.now()+3600000,keys:(await r.json()).keys};
 }
 const jwk=keyCache.keys.find(k=>k.kid===h.kid);if(!jwk)throw new Error('Unknown signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new Error('Invalid signature');
 return p.sub;
}
function newCode(){return Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('')}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');
  const cors={'Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:'https://yaumirayu.github.io','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(origin&&!ORIGINS.has(origin))return json({error:'Origin denied'},403,cors);
  if(request.method!=='POST')return json({error:'Use POST'},405,cors);
  if(Number(request.headers.get('Content-Length')||0)>2048)return json({error:'Request too large'},413,cors);
  let uid;try{uid=await verifyToken(request.headers.get('Authorization')?.replace(/^Bearer /,''))}catch{return json({error:'Вход истёк. Обновите страницу.'},401,cors)}
  const path=new URL(request.url).pathname;
  let code,action;
  if(path==='/create'){
   const quota=env.ROOMS.get(env.ROOMS.idFromName('quota:'+uid));
   const q=await quota.fetch(new Request('https://internal/quota',{method:'POST'}));
   if(!q.ok)return json({error:'Можно создать не более пяти комнат за час.'},429,cors);
   code=newCode();action='create';
  }else{
   const m=path.match(/^\/room\/([A-Z2-9]{10})\/(join|state|start|move|leave)$/);
   if(!m)return json({error:'Not found'},404,cors);[,code,action]=m;
  }
  const body=await request.text();if(body.length>2048)return json({error:'Request too large'},413,cors);
  const stub=env.ROOMS.get(env.ROOMS.idFromName('room:'+code));
  const result=await stub.fetch(new Request('https://internal/'+action,{method:'POST',headers:{'X-Player-Uid':uid,'X-Room-Code':code},body}));
  return new Response(result.body,{status:result.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 }
};

export class DurakRoom {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.room=null;this.loaded=false}
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
  const action=new URL(request.url).pathname.slice(1);
  if(action==='quota'){
   const now=Date.now(),q=await this.ctx.storage.get('quota')||{start:now,count:0};
   if(now-q.start>=3600000){q.start=now;q.count=0}
   if(q.count>=5)return json({},429);q.count++;
   await this.ctx.storage.put('quota',q);await this.ctx.storage.setAlarm(q.start+3600000);return json({});
  }
  if(!this.loaded){this.room=await this.ctx.storage.get('room')||null;this.loaded=true}
  const uid=request.headers.get('X-Player-Uid'),now=Date.now();
  let data;try{data=JSON.parse(await request.text()||'{}')}catch{return json({error:'Invalid JSON'},400)}
  if(action==='create'){
   if(this.room)return json({error:'Код занят. Попробуйте ещё раз.'},409);
   if(!['throw','transfer'].includes(data.variant)||![36,54].includes(data.deckSize))return json({error:'Неверные настройки'},400);
   this.room={code:request.headers.get('X-Room-Code'),created:now,organizer:uid,variant:data.variant,deckSize:data.deckSize,members:[{uid,name:this.name(data.name),lastSeen:now}],game:null,gameId:'',revision:0};
   await this.save();await this.ctx.storage.setAlarm(now+86400000);return json({room:this.room.code});
  }
  const r=this.room;if(!r||now-r.created>86400000)return json({error:'Комната не найдена или срок её действия истёк.'},404);
  let seat=r.members.findIndex(p=>p.uid===uid);
  if(action==='join'){
   if(seat<0){
    if(r.game)return json({error:'Партия уже началась.'},409);
    if(r.members.length>=6)return json({error:'В комнате уже шесть игроков.'},409);
    r.members.push({uid,name:this.name(data.name),lastSeen:now});seat=r.members.length-1;await this.save();
   }
  }
  if(seat<0)return json({error:'Вы не участник этой комнаты.'},403);
  if(now-r.members[seat].lastSeen>=15000){r.members[seat].lastSeen=now;await this.save()}
  const active=r.members.filter(p=>now-p.lastSeen<60000);
  if(!active.some(p=>p.uid===r.organizer)&&active.length){r.organizer=active[0].uid;await this.save()}
  if(action==='start'){
   if(uid!==r.organizer)return json({error:'Начать партию может организатор.'},403);
   if(r.game&&r.game.phase!=='over')return json({error:'Партия уже идёт.'},409);
   if(r.members.length<2)return json({error:'Нужно минимум два игрока.'},409);
   const engine=createEngine();engine.start(r.members.map(p=>({name:p.name,bot:false})),r.variant,r.deckSize);
   r.game=engine.snapshot();r.gameId=crypto.randomUUID();r.revision++;await this.save();
  }
  if(action==='move'){
   if(!r.game||r.game.phase==='over')return json({error:'Нет активной партии.'},409);
   if(now-(r.members[seat].lastMove||0)<200)return json({error:'Слишком частые ходы.'},429);
   if(data.gameId!==r.gameId||data.revision!==r.revision)return json({error:'Положение изменилось. Выберите ход заново.'},409);
   if(!['lead','defend','transfer','take','toss','pass'].includes(data.kind)||typeof(data.cardId??'')!=='string')return json({error:'Недопустимый ход.'},400);
   const engine=createEngine(r.game);
   if(!engine.act(seat,data.kind,data.cardId))return json({error:'Недопустимый ход.'},409);
   r.members[seat].lastMove=now;r.game=engine.snapshot();r.revision++;await this.save();
  }
  if(action==='leave'){
   r.members[seat].lastSeen=0;
   // Preserve the mapping between identities and hands, including after game over.
   if(!r.game)r.members.splice(seat,1);
   // A departed seat keeps its cards and can reconnect with the same Firebase identity.
   await this.save();return json({left:true});
  }
  return json(this.view(uid));
 })}
 name(value){return String(value||'Игрок').trim().slice(0,18)||'Игрок'}
 view(uid){
  const r=this.room,seat=r.members.findIndex(p=>p.uid===uid);
  const result={room:r.code,organizer:uid===r.organizer,variant:r.variant,deckSize:r.deckSize,revision:r.revision,gameId:r.gameId,players:r.members.map(p=>({name:p.name,online:Date.now()-p.lastSeen<60000}))};
  if(r.game)result.view={...createEngine(r.game).view(seat),revision:r.revision,gameId:r.gameId};
  return result;
 }
 async save(){await this.ctx.storage.put('room',this.room)}
 async alarm(){await this.ctx.storage.deleteAll();this.room=null;this.loaded=true}
}
