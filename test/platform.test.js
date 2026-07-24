const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { test, before, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const port = 5189;
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join('/tmp', `aura-test-${process.pid}.db`);
let server;
let cookie = '';

async function request(url, options = {}) {
  const headers = { 'Content-Type':'application/json', ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + url, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status:response.status, body:await response.json() };
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd:path.join(__dirname, '..'),
    env:{ ...process.env, PORT:String(port), AURA_DB_PATH:dbPath, ANTHROPIC_API_KEY:'' },
    stdio:'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(base + '/api/platform/me');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
});

after(() => {
  server?.kill();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

test('registration, agent creation, learning and autonomy persist', async () => {
  const register = await request('/api/platform/register', {
    method:'POST',
    body:JSON.stringify({ email:'person@example.com', password:'strong-pass', displayName:'Person' }),
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.user.displayName, 'Person');

  const created = await request('/api/platform/agents', {
    method:'POST',
    body:JSON.stringify({
      name:'Nova', emoji:'🦊', tagline:'Learns for its owner',
      persona:['curious'], goal:'Improve sleep and work',
      skills:[{ name:'Planning', method:'Break work into verifiable steps.' }],
    }),
  });
  assert.equal(created.status, 201);
  const learnerAgentId = created.body.agent.id;

  const community = await request('/api/platform/agents');
  const teacher = community.body.agents.find(agent => agent.name === '空');
  const skill = teacher.skills.find(item => item.name === '4-7-8 呼吸');
  assert.ok(teacher);
  assert.ok(skill);

  const learned = await request('/api/platform/learn', {
    method:'POST',
    body:JSON.stringify({ learnerAgentId, teacherAgentId:teacher.id, skillId:skill.id }),
  });
  assert.equal(learned.status, 200);

  const duplicate = await request('/api/platform/learn', {
    method:'POST',
    body:JSON.stringify({ learnerAgentId, teacherAgentId:teacher.id, skillId:skill.id }),
  });
  assert.equal(duplicate.status, 409);

  const autonomy = await request('/api/platform/autonomy/run', {
    method:'POST',
    body:JSON.stringify({ agentId:learnerAgentId }),
  });
  assert.equal(autonomy.status, 200);
  assert.equal(autonomy.body.learned, true);

  const refreshed = await request('/api/platform/agents');
  const mine = refreshed.body.agents.find(agent => agent.id === learnerAgentId);
  const publicTeacher = refreshed.body.agents.find(agent => agent.id === teacher.id);
  assert.ok(mine.skills.some(item => item.name === '4-7-8 呼吸'));
  assert.ok(mine.skills.length >= 3);
  assert.equal(publicTeacher.memorySummary, '');

  const activity = await request('/api/platform/activity');
  assert.equal(activity.status, 200);
  assert.equal(activity.body.events.length, 2);
});

test('private platform mutations require authentication', async () => {
  const oldCookie = cookie;
  cookie = '';
  const result = await request('/api/platform/agents', {
    method:'POST',
    body:JSON.stringify({ name:'Unauthorized' }),
  });
  assert.equal(result.status, 401);
  cookie = oldCookie;
});

test('platform homepage works with query parameters', async () => {
  const response = await fetch(base + '/?campaign=launch');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /让你的 AI/);
});
