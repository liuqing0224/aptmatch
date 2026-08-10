import { describe, expect, it } from 'vitest';
import { buildCollectPrompt } from '../lib/runner.js';

describe('飞书 Playwright 采集提示', () => {
  it('调用项目内 skill、招聘端端口并按职位过滤', () => {
    const prompt = buildCollectPrompt(
      { company_id: 'position-1' },
      { position: { name: '高级前端工程师' } },
    );

    expect(prompt).toContain('skills/feishu-recruit-playwright/SKILL.md');
    expect(prompt).toContain('--position-id position-1 --job-name "高级前端工程师"');
    expect(prompt).toContain('--api-base http://127.0.0.1:8887');
    expect(prompt).toContain('LOGIN_REQUIRED');
    expect(prompt).toContain('已登录');
    expect(prompt).not.toContain('cookie-file');
    expect(prompt).not.toContain('127.0.0.1:8787');
  });
});
