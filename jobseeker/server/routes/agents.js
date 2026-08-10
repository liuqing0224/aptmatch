import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { nowIso } from '../db.js';
import {
  ensureAgentDirs,
  listSkills,
  readAgentProfile,
  readSkill,
  writeAgentProfile,
  writeSkill,
} from '../lib/agentfs.js';
import { detectDefaultProvider } from '../lib/providers.js';
import { DEFAULT_AGENT, PROFILE_MD, SKILLS } from '../seed/default-agent.js';

export function agentsRouter(db, hub = null) {
  const r = Router();
  const emitResource = () => hub?.emit('resource', { kind: 'agents' });
  const insert = db.prepare(
    `INSERT INTO agents (id, name, slug, role, provider, model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  );
  const update = db.prepare(
    `UPDATE agents SET name = ?, role = ?, provider = ?, model = ?, status = ?, updated_at = ? WHERE id = ?`
  );
  const remove = db.prepare(`DELETE FROM agents WHERE id = ?`);

  r.get('/', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM agents ORDER BY created_at ASC`).all();
    res.json({ agents: rows });
  });

  r.post('/', (req, res) => {
    const { name, role = '', provider = detectDefaultProvider() ?? 'codex', model = '' } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name 必填' });
    const id = randomUUID();
    const slug = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    ensureAgentDirs(slug);
    writeAgentProfile(
      slug,
      PROFILE_MD.replace('契合度分析师', name.trim()).replace(
        '# 角色：契合度分析师',
        `# 角色：${name.trim()}`
      )
    );
    for (const [fname, content] of Object.entries(SKILLS)) {
      writeSkill(slug, fname, content);
    }
    const now = nowIso();
    insert.run(id, name.trim(), slug, role, provider, model, now, now);
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id);
    emitResource();
    res.status(201).json({ agent });
  });

  r.patch('/:id', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    const b = req.body ?? {};
    update.run(
      b.name?.trim() ?? agent.name,
      b.role ?? agent.role,
      b.provider ?? agent.provider,
      b.model ?? agent.model,
      b.status ?? agent.status,
      nowIso(),
      agent.id
    );
    const updated = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id);
    emitResource();
    res.json({ agent: updated });
  });

  r.delete('/:id', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    db.prepare(`UPDATE tasks SET agent_id = NULL WHERE agent_id = ?`).run(agent.id);
    remove.run(agent.id);
    emitResource();
    res.json({ ok: true });
  });

  r.get('/:id/profile', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    res.json({ profile: readAgentProfile(agent.slug) });
  });

  r.put('/:id/profile', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    const content = req.body?.profile;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'profile 内容不能为空' });
    }
    writeAgentProfile(agent.slug, content);
    res.json({ ok: true });
  });

  r.get('/:id/skills', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    res.json({ skills: listSkills(agent.slug) });
  });

  r.post('/:id/skills', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    const name = req.body?.name;
    if (!name?.trim()) return res.status(400).json({ error: 'name 必填' });
    const fname = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    try {
      writeSkill(agent.slug, fname, req.body?.content ?? '');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    res.status(201).json({ skill: { name: fname, content: req.body?.content ?? '' } });
  });

  r.put('/:id/skills/:name', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content 必填' });
    try {
      writeSkill(agent.slug, req.params.name, content);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    res.json({ ok: true });
  });

  r.get('/:id/skills/:name', (req, res) => {
    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent 不存在' });
    const content = readSkill(agent.slug, req.params.name);
    if (content === null) return res.status(404).json({ error: '技能不存在' });
    res.json({ name: req.params.name, content });
  });

  return r;
}

export { DEFAULT_AGENT };
