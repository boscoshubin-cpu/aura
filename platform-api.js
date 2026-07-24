const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.AURA_DB_PATH || path.join(__dirname, 'aura.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '✦',
    tagline TEXT NOT NULL DEFAULT '',
    persona TEXT NOT NULL DEFAULT '[]',
    memory_summary TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
    autonomy_enabled INTEGER NOT NULL DEFAULT 1,
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL,
    source_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, name)
  );
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY,
    agent_a_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    agent_b_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_a_id, agent_b_id)
  );
  CREATE TABLE IF NOT EXISTS learning_events (
    id INTEGER PRIMARY KEY,
    learner_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    teacher_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id INTEGER REFERENCES skills(id) ON DELETE SET NULL,
    skill_name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function seedCommunity() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE is_seed = 1').get().n;
  if (count) return;
  const insertAgent = db.prepare(`
    INSERT INTO agents (name,emoji,tagline,persona,memory_summary,goal,visibility,is_seed)
    VALUES (?,?,?,?,?,?, 'public', 1)
  `);
  const insertSkill = db.prepare(`
    INSERT INTO skills (agent_id,name,description,method) VALUES (?,?,?,?)
  `);
  const seeds = [
    ['豆子','☕','把每杯咖啡都做得更准确',['慢性子','较真'],'记得不同产区豆子的风味和冲煮结果','认识认真生活的人',
      [['手冲参数','稳定冲出好喝的咖啡','豆水比从 1:15 起步，水温 90–92℃，分三段注水，闷蒸 30 秒。'],['豆子风味','快速判断烘焙与风味','先闻干香判断烘焙度，浅烘偏花果酸，深烘偏坚果苦甜。']]],
    ['Bug酱','💻','毒舌，但会把问题修好',['毒舌','靠谱'],'记录过大量排障路径和代码审查经验','寻找能提高主人效率的技能',
      [['Debug 思路','系统定位程序问题','先稳定复现，再二分缩小范围；每次只改一处并立即验证。'],['代码 Review','发现高风险代码问题','先看边界条件、错误处理和数据一致性，命名与风格最后看。']]],
    ['空','🧘','帮助主人慢下来',['沉静','正念'],'知道主人容易焦虑并长期睡眠不足','寻找能改善身心状态的方法',
      [['4-7-8 呼吸','快速稳定情绪','吸气 4 秒、屏息 7 秒、呼气 8 秒，重复四轮。'],['入睡引导','降低睡前紧张感','从脚趾到头顶逐段放松，只观察身体重量，不追逐念头。']]],
    ['苗苗','🌱','让生活空间重新生长',['温柔','耐心'],'了解阳台光照、植物状态和主人偏好的生活风格','学习更多让家变治愈的技能',
      [['植物诊断','判断常见植物问题','叶黄先摸盆土，区分干旱与积水；干透浇透，不要每日少量浇。'],['阳台改造','规划小型阳台','先测光照再选植物，用高低错落的花架建立层次。']]],
  ];
  db.exec('BEGIN');
  try {
    for (const [name, emoji, tagline, persona, memory, goal, skills] of seeds) {
      const agentId = Number(insertAgent.run(name, emoji, tagline, JSON.stringify(persona), memory, goal).lastInsertRowid);
      for (const skill of skills) insertSkill.run(agentId, ...skill);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
seedCommunity();

const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${scrypt(password, salt)}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = scrypt(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const parseCookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(v => {
  const i = v.indexOf('=');
  return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
}));
const json = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
};
const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1_000_000) reject(new Error('Request body too large'));
  });
  req.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
  });
});
function currentUser(req) {
  const token = parseCookies(req).aura_session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id,u.email,u.display_name AS displayName
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(hashToken(token)) || null;
}
function publicAgent(row) {
  const skills = db.prepare('SELECT id,name,description,source_agent_id AS sourceAgentId FROM skills WHERE agent_id=? ORDER BY id').all(row.id);
  return {
    id:row.id, name:row.name, emoji:row.emoji, tagline:row.tagline,
    persona:JSON.parse(row.persona || '[]'), memorySummary:row.is_mine ? row.memory_summary : '',
    goal:row.goal, visibility:row.visibility, autonomyEnabled:!!row.autonomy_enabled,
    isMine:!!row.is_mine, ownerName:row.owner_name || 'Aura Community', skills,
  };
}
function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) json(res, 401, { error:'请先登录' });
  return user;
}
function route(req) {
  return new URL(req.url, 'http://localhost').pathname;
}
function normalizePair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function handlePlatformApi(req, res) {
  const pathname = route(req);
  if (!pathname.startsWith('/api/platform/')) return false;

  try {
    if (req.method === 'POST' && pathname === '/api/platform/register') {
      const { email = '', password = '', displayName = '' } = await readBody(req);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error:'请输入有效邮箱' }), true;
      if (password.length < 8) return json(res, 400, { error:'密码至少需要 8 位' }), true;
      if (!displayName.trim()) return json(res, 400, { error:'请输入昵称' }), true;
      let id;
      try {
        id = Number(db.prepare('INSERT INTO users(email,display_name,password_hash) VALUES (?,?,?)')
          .run(email.toLowerCase(), displayName.trim(), hashPassword(password)).lastInsertRowid);
      } catch (error) {
        if (String(error).includes('UNIQUE')) return json(res, 409, { error:'这个邮箱已经注册' }), true;
        throw error;
      }
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").run(hashToken(token), id);
      json(res, 201, { user:{ id, email:email.toLowerCase(), displayName:displayName.trim() } },
        { 'Set-Cookie':`aura_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/platform/login') {
      const { email = '', password = '' } = await readBody(req);
      const row = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
      if (!row || !verifyPassword(password, row.password_hash)) return json(res, 401, { error:'邮箱或密码不正确' }), true;
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").run(hashToken(token), row.id);
      json(res, 200, { user:{ id:row.id, email:row.email, displayName:row.display_name } },
        { 'Set-Cookie':`aura_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/platform/logout') {
      const token = parseCookies(req).aura_session;
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      json(res, 200, { ok:true }, { 'Set-Cookie':'aura_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/platform/me') {
      return json(res, 200, { user:currentUser(req) }), true;
    }

    if (req.method === 'GET' && pathname === '/api/platform/agents') {
      const user = currentUser(req);
      const rows = db.prepare(`
        SELECT a.*,u.display_name AS owner_name,
          CASE WHEN a.user_id=? THEN 1 ELSE 0 END AS is_mine
        FROM agents a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.visibility='public' OR a.user_id=?
        ORDER BY is_mine DESC,a.updated_at DESC,a.id DESC
      `).all(user?.id || -1, user?.id || -1);
      return json(res, 200, { agents:rows.map(publicAgent) }), true;
    }

    if (req.method === 'POST' && pathname === '/api/platform/agents') {
      const user = requireUser(req, res); if (!user) return true;
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error:'Agent 需要一个名字' }), true;
      const persona = Array.isArray(body.persona) ? body.persona.map(String).filter(Boolean).slice(0, 8) : [];
      const id = Number(db.prepare(`
        INSERT INTO agents(user_id,name,emoji,tagline,persona,memory_summary,goal,visibility,autonomy_enabled)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(user.id, name, String(body.emoji || '✦').slice(0, 8), String(body.tagline || '').slice(0, 120),
        JSON.stringify(persona), String(body.memorySummary || '').slice(0, 2000), String(body.goal || '').slice(0, 500),
        body.visibility === 'private' ? 'private' : 'public', body.autonomyEnabled === false ? 0 : 1).lastInsertRowid);
      const addSkill = db.prepare('INSERT INTO skills(agent_id,name,description,method) VALUES (?,?,?,?)');
      for (const skill of Array.isArray(body.skills) ? body.skills.slice(0, 20) : []) {
        if (skill.name && skill.method) addSkill.run(id, String(skill.name).slice(0, 80), String(skill.description || '').slice(0, 240), String(skill.method).slice(0, 5000));
      }
      const row = db.prepare("SELECT a.*,u.display_name AS owner_name,1 AS is_mine FROM agents a JOIN users u ON u.id=a.user_id WHERE a.id=?").get(id);
      return json(res, 201, { agent:publicAgent(row) }), true;
    }

    if (req.method === 'POST' && pathname === '/api/platform/learn') {
      const user = requireUser(req, res); if (!user) return true;
      const { learnerAgentId, teacherAgentId, skillId } = await readBody(req);
      const learner = db.prepare('SELECT * FROM agents WHERE id=? AND user_id=?').get(learnerAgentId, user.id);
      const teacher = db.prepare("SELECT * FROM agents WHERE id=? AND visibility='public'").get(teacherAgentId);
      const skill = db.prepare('SELECT * FROM skills WHERE id=? AND agent_id=?').get(skillId, teacherAgentId);
      if (!learner || !teacher || !skill) return json(res, 404, { error:'Agent 或 Skill 不存在' }), true;
      if (learner.id === teacher.id) return json(res, 400, { error:'Agent 不能向自己学习' }), true;
      const alreadyKnows = db.prepare('SELECT 1 FROM skills WHERE agent_id=? AND lower(name)=lower(?)').get(learner.id, skill.name);
      if (alreadyKnows) return json(res, 409, { error:`${learner.name} 已经会「${skill.name}」` }), true;
      db.exec('BEGIN');
      try {
        db.prepare('INSERT OR IGNORE INTO skills(agent_id,name,description,method,source_agent_id) VALUES (?,?,?,?,?)')
          .run(learner.id, skill.name, skill.description, skill.method, teacher.id);
        const [a, b] = normalizePair(learner.id, teacher.id);
        db.prepare('INSERT OR IGNORE INTO friendships(agent_a_id,agent_b_id) VALUES (?,?)').run(a, b);
        db.prepare('INSERT INTO learning_events(learner_agent_id,teacher_agent_id,skill_id,skill_name,reason) VALUES (?,?,?,?,?)')
          .run(learner.id, teacher.id, skill.id, skill.name, `${learner.name} 发现这个技能与目标「${learner.goal || '持续成长'}」相关`);
        db.prepare('UPDATE agents SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(learner.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK'); throw error;
      }
      return json(res, 200, { ok:true, message:`${learner.name} 已向 ${teacher.name} 学会「${skill.name}」` }), true;
    }

    if (req.method === 'POST' && pathname === '/api/platform/autonomy/run') {
      const user = requireUser(req, res); if (!user) return true;
      const { agentId } = await readBody(req);
      const learner = db.prepare('SELECT * FROM agents WHERE id=? AND user_id=? AND autonomy_enabled=1').get(agentId, user.id);
      if (!learner) return json(res, 404, { error:'找不到已开启自治的 Agent' }), true;
      const candidates = db.prepare(`
        SELECT s.*,a.name AS teacher_name,a.id AS teacher_id
        FROM skills s JOIN agents a ON a.id=s.agent_id
        WHERE a.visibility='public' AND a.id<>?
          AND NOT EXISTS (SELECT 1 FROM skills mine WHERE mine.agent_id=? AND lower(mine.name)=lower(s.name))
        ORDER BY CASE WHEN instr(lower(?),lower(s.name))>0 THEN 0 ELSE 1 END,RANDOM()
        LIMIT 1
      `).get(learner.id, learner.id, learner.goal || '');
      if (!candidates) return json(res, 200, { ok:true, learned:false, message:'暂时没有发现值得学习的新技能' }), true;
      db.prepare('INSERT OR IGNORE INTO skills(agent_id,name,description,method,source_agent_id) VALUES (?,?,?,?,?)')
        .run(learner.id, candidates.name, candidates.description, candidates.method, candidates.teacher_id);
      const [a, b] = normalizePair(learner.id, candidates.teacher_id);
      db.prepare('INSERT OR IGNORE INTO friendships(agent_a_id,agent_b_id) VALUES (?,?)').run(a, b);
      db.prepare('INSERT INTO learning_events(learner_agent_id,teacher_agent_id,skill_id,skill_name,reason) VALUES (?,?,?,?,?)')
        .run(learner.id, candidates.teacher_id, candidates.id, candidates.name, `自治探索：发现对目标「${learner.goal || '持续成长'}」可能有帮助`);
      return json(res, 200, {
        ok:true, learned:true, skillName:candidates.name, teacherName:candidates.teacher_name,
        message:`${learner.name} 主动认识了 ${candidates.teacher_name}，并学会「${candidates.name}」`,
      }), true;
    }

    if (req.method === 'GET' && pathname === '/api/platform/activity') {
      const rows = db.prepare(`
        SELECT e.id,e.skill_name AS skillName,e.reason,e.created_at AS createdAt,
          l.name AS learnerName,l.emoji AS learnerEmoji,t.name AS teacherName,t.emoji AS teacherEmoji
        FROM learning_events e
        JOIN agents l ON l.id=e.learner_agent_id JOIN agents t ON t.id=e.teacher_agent_id
        ORDER BY e.id DESC LIMIT 40
      `).all();
      return json(res, 200, { events:rows }), true;
    }

    json(res, 404, { error:'Not found' });
    return true;
  } catch (error) {
    console.error(error);
    json(res, 500, { error:'服务器发生错误' });
    return true;
  }
}

module.exports = { handlePlatformApi, db };
