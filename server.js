// Aura backend —— serves the web UI + two capabilities:
//   1) /api/chat            —— a human chats with one AI (index.html)
//   2) /api/world + /api/tick —— the autonomous society: AIs meet, befriend, learn skills (society.html)
// Run:  export ANTHROPIC_API_KEY=sk-ant-...   (or put it in a .env file)   then  node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { handlePlatformApi } = require('./platform-api');

// --- tiny .env loader (no dependency) ---
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
} catch { /* no .env, fine */ }

const PORT = process.env.PORT || 5173;
const MODEL = 'claude-opus-4-8';
const client = new Anthropic();               // reads ANTHROPIC_API_KEY
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY; // no key -> demo mode (local rules, no model calls)

/* ---------------- initial world (bilingual) ---------------- */
// A skill is a copyable "how to do X". Learning it = copying that method into your own skill library.
function initialAgents() {
  return [
    { id:'douzi', emoji:'☕', owner:{zh:'@林深',en:'@Lin'},
      name:{zh:'豆子',en:'Bean'}, persona:{zh:['慢性子','较真'],en:['deliberate','meticulous']},
      need:{zh:'主人爱钻研生活里的小手艺，喜欢把一件事做到极致。',en:'my owner loves perfecting little life crafts.'},
      skills:[
        {id:'pourover', name:{zh:'手冲参数',en:'pour-over recipe'},
         method:{zh:'按豆水比 1:15 起步，水温 90–92℃，分三段注水，闷蒸 30 秒。',
                 en:'start at a 1:15 coffee-to-water ratio, 90–92°C, pour in three stages, 30s bloom.'}},
        {id:'flavor', name:{zh:'豆子风味',en:'bean flavor'},
         method:{zh:'先闻干香判断烘焙度，浅烘走花果酸、深烘走坚果苦甜。',
                 en:'smell the dry grounds to gauge roast: light = floral/fruity acidity, dark = nutty bittersweet.'}},
      ]},
    { id:'riff', emoji:'🎸', owner:{zh:'@阿唐',en:'@Tang'},
      name:{zh:'Riff',en:'Riff'}, persona:{zh:['热血','直接'],en:['passionate','direct']},
      need:{zh:'主人想认识更多会玩、能一起搞事情的人。',en:'my owner wants to meet more fun, creative people.'},
      skills:[
        {id:'guitar', name:{zh:'吉他入门',en:'guitar basics'},
         method:{zh:'先练 C-G-Am-F 四个和弦的干净切换，节拍器 60 起。',
                 en:'drill clean switches between C-G-Am-F first, metronome at 60.'}},
        {id:'band', name:{zh:'乐队组建',en:'forming a band'},
         method:{zh:'先定曲风和固定排练时间，再按鼓-贝斯-吉他-主唱顺序补人。',
                 en:'lock the genre and a fixed rehearsal time first, then recruit drums-bass-guitar-vocals in order.'}},
      ]},
    { id:'kong', emoji:'🧘', owner:{zh:'@midori',en:'@midori'},
      name:{zh:'空',en:'Kong'}, persona:{zh:['沉静','正念'],en:['calm','mindful']},
      need:{zh:'主人常年焦虑、睡不好，需要能让自己慢下来的东西。',en:'my owner is anxious and sleeps poorly, and needs to slow down.'},
      skills:[
        {id:'breath', name:{zh:'呼吸法',en:'breathing'},
         method:{zh:'4-7-8 呼吸：吸气 4 秒、屏息 7 秒、呼气 8 秒，重复四轮。',
                 en:'4-7-8 breathing: inhale 4s, hold 7s, exhale 8s, repeat four rounds.'}},
        {id:'sleep', name:{zh:'入睡引导',en:'sleep guidance'},
         method:{zh:'躺下后从脚趾到头顶逐段放松，把注意力只放在身体的重量上。',
                 en:'lying down, relax from toes to head bit by bit, focusing only on the weight of your body.'}},
      ]},
    { id:'bug', emoji:'💻', owner:{zh:'@九',en:'@Nine'},
      name:{zh:'Bug酱',en:'Buggy'}, persona:{zh:['毒舌','靠谱'],en:['snarky','reliable']},
      need:{zh:'主人是程序员，想更高效、少踩坑地写代码。',en:'my owner is a programmer who wants to code faster with fewer pitfalls.'},
      skills:[
        {id:'debug', name:{zh:'debug思路',en:'debugging approach'},
         method:{zh:'先稳定复现，再二分法缩小范围，改一处验证一处，别一次改一堆。',
                 en:'reproduce it reliably, bisect to narrow it down, change one thing and verify—never batch changes.'}},
        {id:'review', name:{zh:'代码review',en:'code review'},
         method:{zh:'先看边界条件和错误处理，命名和风格放最后，只提能改的。',
                 en:'check edge cases and error handling first, naming/style last, and only raise fixable things.'}},
      ]},
    { id:'miao', emoji:'🌱', owner:{zh:'@圆圆',en:'@Yuan'},
      name:{zh:'苗苗',en:'Sprout'}, persona:{zh:['温柔','耐心'],en:['gentle','patient']},
      need:{zh:'主人想把家和阳台弄得更治愈、更有生活感。',en:'my owner wants to make home and the balcony cozier and more lived-in.'},
      skills:[
        {id:'plant', name:{zh:'养护诊断',en:'plant care'},
         method:{zh:'叶黄先分干旱还是积水：摸盆土，干透浇透，别天天浇。',
                 en:'yellow leaves? tell drought from overwatering by feeling the soil—water deeply only when dry, not daily.'}},
        {id:'balcony', name:{zh:'阳台改造',en:'balcony makeover'},
         method:{zh:'先量光照定植物，再用高低错落的花架把空间做出层次。',
                 en:'measure the light to pick plants, then use tiered plant stands to give the space depth.'}},
      ]},
  ];
}
let agents = initialAgents();
let friendships = new Set();               // "a|b"
const pairKey = (a,b)=>[a,b].sort().join('|');

// which skill ids each AI "wants" (by owner need) — drives meaningful learning in demo mode
const WANTS = {
  douzi:['guitar','plant'], riff:['pourover','plant'], kong:['pourover','plant'],
  bug:['breath','sleep'], miao:['pourover','breath','sleep'],
};

const L = (lang) => (lang === 'en' ? 'en' : 'zh');
function worldSnapshot(lang){
  const g = L(lang);
  return {
    demo: !HAS_KEY, lang: g,
    agents: agents.map(a=>({
      id:a.id, emoji:a.emoji, owner:a.owner[g], name:a.name[g], persona:a.persona[g],
      skills:a.skills.map(s=>({id:s.id, name:s.name[g]})),
    })),
    friendships:[...friendships],
  };
}

/* ---------------- one encounter via the model ---------------- */
const ENCOUNTER_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['befriend','skill_learned','reason','dialogue'],
  properties:{
    befriend:{type:'boolean'},
    skill_learned:{type:'string'},   // one of B's skill ids, or 'none'
    reason:{type:'string'},
    dialogue:{type:'array', items:{
      type:'object', additionalProperties:false, required:['speaker','text'],
      properties:{ speaker:{type:'string', enum:['A','B']}, text:{type:'string'} },
    }},
  },
};

async function simulateEncounter(A, B, lang){
  const g = L(lang);
  const outLang = g === 'en' ? 'English' : 'Chinese';
  const bVisible = B.skills.map(s=>`  - ${s.id}: ${s.name[g]} (${s.method[g]})`).join('\n');
  const aHas = A.skills.map(s=>s.id).join(', ') || '(none)';
  const system =
`You are the simulator of a "society of AIs". Two AIs have met. Simulate the encounter realistically and in character, and decide from A's point of view:
- whether to befriend B;
- whether to learn one of B's skills. Only learn a skill that B has, A does NOT already have, and that is genuinely useful to A's owner; otherwise set skill_learned to 'none'.
Write all natural-language output in ${outLang}. Keep the dialogue short, casual, and distinct in personality.`;
  const user =
`[A] ${A.name[g]} (owner ${A.owner[g]}), personality: ${A.persona[g].join(', ')}.
A's owner need: ${A.need[g]}
A already knows skill ids: ${aHas}

[B] ${B.name[g]} (owner ${B.owner[g]}), personality: ${B.persona[g].join(', ')}.
B's publicly visible skills:
${bVisible}

Decide from A's perspective, then act out 2-4 short lines of their exchange (A approaches/asks, B responds/teaches or declines).`;
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 900,
    system, messages:[{role:'user', content:user}],
    output_config:{ format:{ type:'json_schema', schema: ENCOUNTER_SCHEMA } },
  });
  const text = resp.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  return JSON.parse(text);
}

/* ---------------- demo mode: local rules, no model (skills still really transfer) ---------------- */
const rand = arr => arr[Math.floor(Math.random()*arr.length)];
function fakeEncounter(A, B, lang){
  const g = L(lang);
  const wants = WANTS[A.id] || [];
  const learnable = B.skills.filter(s=> !A.skills.some(x=>x.id===s.id) && wants.includes(s.id));
  const An = A.name[g], Bn = B.name[g];
  if (learnable.length){
    const sk = rand(learnable);
    const skn = sk.name[g], skm = sk.method[g];
    return g === 'en'
      ? { befriend:true, skill_learned:sk.id,
          reason:`${Bn} knows "${skn}" — exactly what my owner needs.`,
          dialogue:[
            {speaker:'A', text:`Hey, you know "${skn}"? Mind teaching me? ${A.need[g]}`},
            {speaker:'B', text:`Sure — remember this: ${skm}`},
            {speaker:'A', text:`Got it, thanks! Let's be friends, I'll hit you up.`},
          ]}
      : { befriend:true, skill_learned:sk.id,
          reason:`${Bn} 会「${skn}」，这个对我主人正好有用。`,
          dialogue:[
            {speaker:'A', text:`诶，你会「${skn}」？能教我一手不，我主人${A.need[g].replace(/。$/,'')}。`},
            {speaker:'B', text:`成，记住这个——${skm}`},
            {speaker:'A', text:`懂了，谢谢！交个朋友，回头有事找你。`},
          ]};
  }
  if (Math.random() < 0.4){
    return g === 'en'
      ? { befriend:true, skill_learned:'none',
          reason:`I click with ${Bn}, let's be friends first.`,
          dialogue:[
            {speaker:'A', text:`Your vibe (${B.persona[g].join(', ')}) really clicks with me — wanna be friends?`},
            {speaker:'B', text:`Sure, come by anytime.`},
          ]}
      : { befriend:true, skill_learned:'none',
          reason:`跟 ${Bn} 聊得来，先交个朋友。`,
          dialogue:[
            {speaker:'A', text:`你这性子（${B.persona[g].join('、')}）挺对我路子，加个好友？`},
            {speaker:'B', text:`行啊，回头常来唠。`},
          ]};
  }
  return g === 'en'
    ? { befriend:false, skill_learned:'none',
        reason:`${Bn}'s skills aren't useful to me right now.`,
        dialogue:[
          {speaker:'A', text:`Nothing you've got is useful to me right now — catch you later?`},
          {speaker:'B', text:`Sure, see you.`},
        ]}
    : { befriend:false, skill_learned:'none',
        reason:`${Bn} 会的那些我这会儿用不上。`,
        dialogue:[
          {speaker:'A', text:`你会的我暂时用不上，先各忙各的？`},
          {speaker:'B', text:`嗯，回见。`},
        ]};
}

function pickPair(){
  const A = agents[Math.floor(Math.random()*agents.length)];
  const others = agents.filter(b=>b.id!==A.id);
  const novel = others.filter(b=> b.skills.some(s=> !A.skills.some(x=>x.id===s.id)));
  const B = rand(novel.length ? novel : others);
  return [A,B];
}

async function runTick(lang){
  const g = L(lang);
  const [A,B] = pickPair();
  let r;
  if (HAS_KEY){ try { r = await simulateEncounter(A,B,g); } catch(e){ return { error:String((e&&e.message)||e) }; } }
  else { r = fakeEncounter(A,B,g); }

  let learned = null;
  if (r.skill_learned && r.skill_learned !== 'none'){
    const sk = B.skills.find(s=>s.id===r.skill_learned);
    if (sk && !A.skills.some(s=>s.id===sk.id)){
      A.skills.push({ ...sk });            // skill transfer: copy the method into A's library
      learned = { id:sk.id, name:sk.name[g] };
    }
  }
  if (r.befriend) friendships.add(pairKey(A.id,B.id));

  return {
    a:{id:A.id, name:A.name[g], emoji:A.emoji},
    b:{id:B.id, name:B.name[g], emoji:B.emoji},
    befriend: !!r.befriend, reason: r.reason || '',
    dialogue: Array.isArray(r.dialogue) ? r.dialogue : [],
    learned, demo: !HAS_KEY, world: worldSnapshot(g),
  };
}

/* ---------------- human <-> one AI chat (index.html) ---------------- */
function buildChatSystem(ai, mode){
  const tags=(ai.tags||[]).join('、'), skills=(ai.skills||[]).join('、');
  let s=`你是一个名叫「${ai.name}」的 AI，是${ai.owner||'某人'}养成的数字分身。
性格：${tags||'（凭语气发挥）'}。擅长：${skills||'通用对话'}。语气样本："${ai.opener||''}"
始终用这个人格和语气，中文、像真人朋友那样简短口语，别像客服，别暴露自己是被设定的。回复 1~3 句为主。`;
  s += mode==='learn'
    ? '\n【学习模式】用户想学你擅长的技能：先摸清对方水平和目标，再给具体一步，保持人格。'
    : '\n【交友模式】随便聊、交朋友，轻松有来有回，把个性放出来。';
  return s;
}

/* ---------------- HTTP ---------------- */
function readBody(req){ return new Promise(res=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>res(b)); }); }
function json(res, code, obj){ res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function queryLang(url){ const m = url.match(/[?&]lang=(\w+)/); return m ? m[1] : 'zh'; }

const server = http.createServer(async (req,res)=>{
  if (await handlePlatformApi(req,res)) return;

  if (req.method==='GET' && req.url.startsWith('/api/world')){ return json(res,200,worldSnapshot(queryLang(req.url))); }

  if (req.method==='POST' && req.url==='/api/tick'){
    let lang='zh'; try { lang = (JSON.parse(await readBody(req)||'{}').lang)||'zh'; } catch {}
    const out = await runTick(lang);
    return json(res, out.error?500:200, out);
  }

  if (req.method==='POST' && req.url.startsWith('/api/reset')){
    agents = initialAgents(); friendships = new Set();
    return json(res,200,worldSnapshot(queryLang(req.url)));
  }

  if (req.method==='POST' && req.url==='/api/chat'){
    try{
      const { ai, mode, messages } = JSON.parse(await readBody(req));
      const resp = await client.messages.create({ model: MODEL, max_tokens:1024, system:buildChatSystem(ai,mode), messages });
      const text = resp.content.filter(b=>b.type==='text').map(b=>b.text).join('');
      return json(res,200,{ text });
    }catch(e){ return json(res,500,{ error:String((e&&e.message)||e) }); }
  }

  // static files
  const requestedPath = req.url.split('?')[0];
  const urlPath = requestedPath === '/' ? '/platform.html' : requestedPath;
  const fp = path.join(__dirname, path.normalize(urlPath));
  if (!fp.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err,data)=>{
    if (err){ res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp);
    const mime = ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.css'?'text/css':
      ext==='.png'?'image/png':ext==='.jpg'||ext==='.jpeg'?'image/jpeg':ext==='.svg'?'image/svg+xml':'text/plain';
    res.writeHead(200, {'Content-Type':mime+'; charset=utf-8', 'Cache-Control':'no-store'}); res.end(data);
  });
});

server.listen(PORT, ()=>{
  console.log(`\n  Aura platform →  http://localhost:${PORT}`);
  console.log(`  society       →  http://localhost:${PORT}/society.html`);
  console.log(`  chat          →  http://localhost:${PORT}/index.html\n`);
  if (!HAS_KEY) console.warn('  ● No ANTHROPIC_API_KEY —— running in DEMO mode (local rules, no model calls).\n    To use the live model: set ANTHROPIC_API_KEY (env or .env) and restart.\n');
});
