import { DATA_DIR } from './paths.js';
import { detectDefaultProvider, scanProviders } from './providers.js';

export const DEFAULT_SETTINGS = {
  defaultProvider: 'codex', // 兜底值；未显式配置时使用扫描检测到的本地 coding agent
  concurrency: 1,
  timeoutMinutes: 10,
  dataDir: DATA_DIR,
};

let detectedDefault = detectDefaultProvider() ?? 'codex';

/** 重新扫描本机 CLI 并刷新「未显式配置时的默认 Provider」。 */
export function refreshDetectedDefault(scanned) {
  detectedDefault = detectDefaultProvider(scanned ?? scanProviders({ force: true })) ?? 'codex';
  return detectedDefault;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    defaultProvider: overrides.defaultProvider ?? detectedDefault,
    concurrency: Number(overrides.concurrency ?? DEFAULT_SETTINGS.concurrency),
    timeoutMinutes: Number(overrides.timeoutMinutes ?? DEFAULT_SETTINGS.timeoutMinutes),
    dataDir: DEFAULT_SETTINGS.dataDir,
  };
}

export function setSettings(db, patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k) && v !== undefined && v !== null) {
      stmt.run(k, String(v));
    }
  }
  return getSettings(db);
}
