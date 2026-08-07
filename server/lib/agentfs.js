import fs from 'node:fs';
import path from 'node:path';
import { AGENTS_DIR } from './paths.js';

export function agentDir(slug) {
  return path.join(AGENTS_DIR, slug);
}

export function skillsDir(slug) {
  return path.join(agentDir(slug), 'skills');
}

export function ensureAgentDirs(slug) {
  fs.mkdirSync(skillsDir(slug), { recursive: true });
}

export function readAgentProfile(slug) {
  const p = path.join(agentDir(slug), 'AGENTS.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

export function writeAgentProfile(slug, content) {
  const p = path.join(agentDir(slug), 'AGENTS.md');
  fs.writeFileSync(p, content, 'utf8');
  return content;
}

export function listSkills(slug) {
  const dir = skillsDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const p = path.join(dir, f);
      return {
        name: f,
        path: p,
        content: fs.readFileSync(p, 'utf8'),
      };
    });
}

export function readSkill(slug, name) {
  if (!/^[a-zA-Z0-9-]+\.md$/.test(name)) return null;
  const p = path.join(skillsDir(slug), name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

export function writeSkill(slug, name, content) {
  if (!/^[a-zA-Z0-9-]+\.md$/.test(name)) {
    throw new Error('技能文件名只允许字母、数字和连字符，且以 .md 结尾');
  }
  const p = path.join(skillsDir(slug), name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return content;
}

export function appendLearnings(slug, learnings) {
  if (!slug || !Array.isArray(learnings) || learnings.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const lines = learnings
    .filter((l) => typeof l === 'string' && l.trim())
    .map((l) => `- [${today}] ${l.trim().replace(/^-\s*(\[\d{4}-\d{2}-\d{2}\]\s*)+/, '').trim()}`);
  if (lines.length === 0) return;
  const p = path.join(skillsDir(slug), 'learnings.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const head = '# 学习沉淀\n\n每次任务自动追加，人工可在 Agent 管理中编辑。\n\n';
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const body = existing.startsWith(head) ? existing.slice(head.length) : existing;
  fs.writeFileSync(p, head + body.trimEnd() + '\n' + lines.join('\n') + '\n', 'utf8');
}
