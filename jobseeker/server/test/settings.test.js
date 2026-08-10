import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { getSettings, setSettings } from '../lib/settings.js';

describe('settings', () => {
  it('未显式配置时 defaultProvider 来自扫描检测（codex/cursor/claude/opencode 之一）', () => {
    const db = openDb(':memory:');
    const settings = getSettings(db);
    expect(['codex', 'cursor', 'claude', 'opencode']).toContain(settings.defaultProvider);
    expect(settings.concurrency).toBe(1);
    expect(settings.timeoutMinutes).toBe(10);
  });

  it('显式保存的 defaultProvider 覆盖检测结果', () => {
    const db = openDb(':memory:');
    setSettings(db, { defaultProvider: 'cursor' });
    expect(getSettings(db).defaultProvider).toBe('cursor');
  });
});
