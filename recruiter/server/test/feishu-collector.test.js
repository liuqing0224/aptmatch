import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  collectInterceptedList,
  createListInterceptor,
  isFeishuLoginUrl,
  matchesJob,
  parseArgs,
  toMarkdown,
} from '../../skills/feishu-recruit-playwright/scripts/collect.mjs';

describe('飞书 Playwright collector', () => {
  it('默认使用招聘 API 且不接受 Cookie 参数', () => {
    const args = parseArgs(['--job-name', '前端', '--position-id', 'p1', '--import']);
    expect(args.apiBase).toBe('http://127.0.0.1:8887');
    expect(args.profileDir).toContain('recruiter/.data/feishu-playwright-profile');
    expect(() => parseArgs(['--cookie-file', '/tmp/cookie'])).toThrow('未知参数');
  });

  it('按职位名匹配候选人，不把不相关职位混入', () => {
    expect(matchesJob({ job: { title: '高级前端工程师' } }, '高级前端工程师')).toBe(true);
    expect(matchesJob({ job: { title: '高级前端工程师（上海）' } }, '高级前端工程师')).toBe(true);
    expect(matchesJob({ job: { title: 'AI 产品经理' } }, '高级前端工程师')).toBe(false);
  });

  it('区分飞书登录页与招聘业务页，登录完成后可安全恢复列表导航', () => {
    expect(isFeishuLoginUrl('https://accounts.feishu.cn/accounts/page/login')).toBe(true);
    expect(isFeishuLoginUrl('https://passport.feishu.cn/sso/login')).toBe(true);
    expect(isFeishuLoginUrl('https://guanghe.feishu.cn/hire/application-biz/evaluation/list')).toBe(false);
  });

  it('把解析简历转成可分析 Markdown', () => {
    const markdown = toMarkdown({
      name: '张三',
      experience_years: 5,
      educations: [{ school: '示例大学', major: '计算机', degree: 6 }],
      careers: [{ company: '示例公司', title: '前端工程师', jd: '负责平台研发' }],
    });
    expect(markdown).toContain('# 张三');
    expect(markdown).toContain('工作年限：5年');
    expect(markdown).toContain('示例大学');
    expect(markdown).toContain('负责平台研发');
  });

  it('只从 Playwright 页面响应事件收集并合并招聘列表', async () => {
    class FakePage extends EventEmitter {}
    const page = new FakePage();
    const interceptor = createListInterceptor(page, 0);
    const response = (items, count, offset) => ({
      url: () => 'https://guanghe.feishu.cn/atsx/api/evaluation/list_v2/',
      request: () => ({
        method: () => 'POST',
        postDataJSON: () => ({ activity_status: 0, offset }),
      }),
      json: async () => ({ success: true, data: { evaluation_list: items, count } }),
    });

    page.emit('response', response([{ application_id: 'a1', talent_id: 't1' }], 2, 0));
    await interceptor.waitForChange(10);
    page.emit('response', response([
      { application_id: 'a1', talent_id: 't1' },
      { application_id: 'a2', talent_id: 't2' },
    ], 2, 1));
    await interceptor.waitForChange(10);

    const items = await collectInterceptedList(page, interceptor, { timeoutSeconds: 1 });
    expect(items.map((item) => item.application_id)).toEqual(['a1', 'a2']);
    expect(interceptor.snapshot()).toMatchObject({ total: 2, responses: 2 });
    interceptor.dispose();
    expect(page.listenerCount('response')).toBe(0);
  });

  it('已登录时不等待扫码：列表接口无响应则快速失败而非提示登录', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      class FakePage extends EventEmitter {}
      const page = new FakePage();
      const interceptor = createListInterceptor(page, 0);
      await expect(
        collectInterceptedList(page, interceptor, { timeoutSeconds: 10, listTimeoutSeconds: 0.05 })
      ).rejects.toThrow('已登录但招聘列表接口未在');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('已登录'));
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('LOGIN_REQUIRED'));
      interceptor.dispose();
    } finally {
      log.mockRestore();
    }
  });
});
