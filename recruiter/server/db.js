import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR } from './lib/paths.js';

let db = null;

export function getDb() {
  if (db) return db;
  db = openDb(path.join(DATA_DIR, 'app.db'));
  return db;
}

export function openDb(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const d = new Database(file);
  if (file !== ':memory:') {
    d.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(d);
  return d;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'codex',
      model TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      source_file TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT DEFAULT '',
      stage TEXT DEFAULT '',
      url TEXT DEFAULT '',
      jd_text TEXT NOT NULL,
      source_file TEXT DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'company',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'fit',
      agent_id TEXT,
      resume_id TEXT,
      company_id TEXT,
      parent_task_id TEXT,
      extra_prompt TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      error TEXT DEFAULT '',
      pid INTEGER,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blacklist_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'master',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_error TEXT DEFAULT '',
      entry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blacklist_entries (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      industry TEXT DEFAULT '',
      city TEXT DEFAULT '',
      address TEXT DEFAULT '',
      issue TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      added_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blacklist_entries_name ON blacklist_entries(company_name);
    CREATE INDEX IF NOT EXISTS idx_blacklist_entries_source ON blacklist_entries(source_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_blacklist_entries_source_name_city
      ON blacklist_entries(source_id, company_name, city);
  `);

  // 迁移：companies.kind（旧库补列，默认 company 不影响求职端）
  const companyCols = d.prepare(`PRAGMA table_info(companies)`).all().map((c) => c.name);
  if (!companyCols.includes('kind')) {
    d.exec(`ALTER TABLE companies ADD COLUMN kind TEXT NOT NULL DEFAULT 'company'`);
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      resume_id TEXT NOT NULL,
      position_id TEXT NOT NULL,
      source_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '待筛',
      overall_score INTEGER,
      grade TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_position_source
      ON candidates(position_id, source_url);
  `);
}

export function nowIso() {
  return new Date().toISOString();
}

export function rowById(d, table, id) {
  return d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) ?? null;
}
