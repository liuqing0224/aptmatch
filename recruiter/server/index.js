import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getDb, nowIso } from './db.js';
import { TaskRunner } from './lib/runner.js';
import { createQueue, recoverRunningTasks } from './lib/queue.js';
import { getSettings } from './lib/settings.js';
import { DIST_DIR, ROOT_DIR } from './lib/paths.js';
import { agentsRouter } from './routes/agents.js';
import { tasksRouter } from './routes/tasks.js';
import { settingsRouter } from './routes/settings.js';
import { blacklistRouter } from './routes/blacklist.js';
import { positionsRouter } from './routes/positions.js';
import { candidatesRouter } from './routes/candidates.js';
import { createFetcher, syncAll } from './lib/blacklist.js';
import { fetchDocFromLark } from './lib/lark.js';
import { DEFAULT_AGENT, PROFILE_MD, SKILLS } from './seed/default-agent.js';
import { ensureAgentDirs, writeAgentProfile, writeSkill } from './lib/agentfs.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

export function createApp({ db = getDb() } = {}) {
  seedDefaultAgent(db);
  const settings = () => getSettings(db);
  const runner = new TaskRunner({ db, getSettings: settings });
  const queue = createQueue({ db, runner, getSettings: settings });

  recoverRunningTasks(db);

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: nowIso() }));
  app.use('/api/agents', agentsRouter(db));
  app.use('/api/tasks', tasksRouter(db, runner, queue));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/blacklist', blacklistRouter(db, { getFetcher: () => createFetcher() }));
  app.use('/api/positions', positionsRouter(db, { fetchDoc: fetchDocFromLark }));
  app.use('/api/candidates', candidatesRouter(db, queue));

  seedDefaultBlacklistSource(db);
  // 启动后懒同步：首次运行的黑名单来源在后台拉取，失败不阻塞主流程
  scheduleLazyBlacklistSync(db);

  // 生产模式：托管前端构建产物
  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(path.join(DIST_DIR, 'index.html'));
      }
      next();
    });
  }

  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  return { app, queue, runner, db };
}

function seedDefaultAgent(db) {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM agents`).get().n;
  if (existing > 0) return;
  ensureAgentDirs(DEFAULT_AGENT.slug);
  writeAgentProfile(DEFAULT_AGENT.slug, PROFILE_MD);
  for (const [name, content] of Object.entries(SKILLS)) {
    writeSkill(DEFAULT_AGENT.slug, name, content);
  }
  const now = nowIso();
  db.prepare(
    `INSERT INTO agents (id, name, slug, role, provider, model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    'agent-default',
    DEFAULT_AGENT.name,
    DEFAULT_AGENT.slug,
    DEFAULT_AGENT.role,
    DEFAULT_AGENT.provider,
    DEFAULT_AGENT.model,
    now,
    now
  );
}

const DEFAULT_BLACKLIST_SOURCE = {
  name: '996ICU 企业黑名单（主要城市）',
  owner: 'it-job-blacklist',
  repo: '996ICU.job.blacklist_company',
  branch: 'master',
};

function seedDefaultBlacklistSource(db) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM blacklist_sources`).get().n;
  if (n > 0) return;
  const now = nowIso();
  db.prepare(
    `INSERT INTO blacklist_sources (id, name, owner, repo, branch, enabled, created_at, updated_at)
     VALUES ('blk-default', ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    DEFAULT_BLACKLIST_SOURCE.name,
    DEFAULT_BLACKLIST_SOURCE.owner,
    DEFAULT_BLACKLIST_SOURCE.repo,
    DEFAULT_BLACKLIST_SOURCE.branch,
    now,
    now
  );
}

function scheduleLazyBlacklistSync(db) {
  if (db.name === ':memory:') return; // 测试用内存库不触发网络同步
  const rows = db
    .prepare(`SELECT * FROM blacklist_sources WHERE enabled = 1 AND last_synced_at IS NULL`)
    .all();
  if (rows.length === 0) return;
  setTimeout(() => {
    syncAll(db)
      .then((results) => {
        for (const r of results) {
          if (r.error) console.warn(`[blacklist] 同步失败 ${r.name}: ${r.error}`);
        }
      })
      .catch((err) => console.warn('[blacklist] 同步异常:', err?.message ?? err));
  }, 3000);
}

// 直接运行时启动服务
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, queue } = createApp();
  queue.start();
  app.listen(PORT, HOST, () => {
    console.log(`Job-Fit Matcher 已启动：http://${HOST}:${PORT}`);
    console.log(`工作目录：${ROOT_DIR}`);
  });
}
