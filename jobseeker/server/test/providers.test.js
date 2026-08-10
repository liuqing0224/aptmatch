import { describe, expect, it } from 'vitest';
import { buildCommand, detectDefaultProvider, PROVIDERS, scanProviders } from '../lib/providers.js';

const base = { workspace: '/tmp/ws', prompt: '分析' };

const fakeLookup = (found) => ({
  whichCmd: (cmd) => (found[cmd] ? `/usr/local/bin/${cmd}` : null),
  versionCmd: (cmd) => (found[cmd] ? '1.2.3' : null),
});

describe('buildCommand', () => {
  it('codex 使用 exec 非交互参数', () => {
    const c = buildCommand('codex', base);
    expect(c.cmd).toBe('codex');
    expect(c.args).toContain('exec');
    expect(c.args).toContain('--json');
    expect(c.args).toContain('--skip-git-repo-check');
    expect(c.args).toContain('danger-full-access');
    expect(c.cwd).toBe('/tmp/ws');
  });

  it('cursor 使用 agent -p', () => {
    const c = buildCommand('cursor', base);
    expect(c.cmd).toBe('cursor');
    expect(c.args).toContain('agent');
    expect(c.args).toContain('-p');
    expect(c.args).toContain('--workspace');
  });

  it('claude 使用 print 模式与允许工具', () => {
    const c = buildCommand('claude', base);
    expect(c.cmd).toBe('claude');
    expect(c.args).toContain('-p');
    expect(c.args.join(' ')).toContain('--allowedTools');
  });

  it('opencode 使用 run 非交互参数', () => {
    const c = buildCommand('opencode', base);
    expect(c.cmd).toBe('opencode');
    expect(c.args).toContain('run');
    expect(c.args).toContain('--dir');
    expect(c.args).toContain('--auto');
    expect(c.cwd).toBe('/tmp/ws');
  });

  it('传入 model 时追加参数', () => {
    const c = buildCommand('codex', { ...base, model: 'gpt-5' });
    expect(c.args).toContain('-m');
    expect(c.args).toContain('gpt-5');
  });

  it('未知 provider 抛错', () => {
    expect(() => buildCommand('nope', base)).toThrow(/未知 provider/);
  });
});

describe('scanProviders', () => {
  it('扫描 PATH 发现已安装的 CLI，并给出路径与版本', () => {
    const providers = scanProviders(fakeLookup({ codex: true, claude: true }));
    const codex = providers.find((p) => p.id === 'codex');
    expect(codex.available).toBe(true);
    expect(codex.cmd).toBe('/usr/local/bin/codex');
    expect(codex.version).toBe('1.2.3');

    const cursor = providers.find((p) => p.id === 'cursor');
    expect(cursor.available).toBe(false);
    expect(cursor.cmd).toBeNull();
    expect(cursor.version).toBeNull();
  });

  it('全部未安装时都标记为不可用', () => {
    const providers = scanProviders(fakeLookup({}));
    expect(providers.every((p) => !p.available)).toBe(true);
  });

  it('按 PROVIDERS 定义的顺序返回', () => {
    expect(scanProviders(fakeLookup({})).map((p) => p.id)).toEqual(PROVIDERS.map((p) => p.id));
  });

  it('检测 opencode 已安装的 CLI', () => {
    const providers = scanProviders(fakeLookup({ opencode: true }));
    const opencode = providers.find((p) => p.id === 'opencode');
    expect(opencode.available).toBe(true);
    expect(opencode.cmd).toBe('/usr/local/bin/opencode');
    expect(opencode.version).toBe('1.2.3');
  });
});

describe('detectDefaultProvider', () => {
  it('按 codex → cursor → claude → opencode 优先级选择第一个可用者', () => {
    expect(
      detectDefaultProvider(scanProviders(fakeLookup({ codex: true, cursor: true })))
    ).toBe('codex');
    expect(
      detectDefaultProvider(scanProviders(fakeLookup({ cursor: true, claude: true })))
    ).toBe('cursor');
    expect(detectDefaultProvider(scanProviders(fakeLookup({ claude: true })))).toBe('claude');
    expect(
      detectDefaultProvider(scanProviders(fakeLookup({ claude: true, opencode: true })))
    ).toBe('claude');
    expect(detectDefaultProvider(scanProviders(fakeLookup({ opencode: true })))).toBe('opencode');
  });

  it('全部不可用时返回 null', () => {
    expect(detectDefaultProvider(scanProviders(fakeLookup({})))).toBeNull();
  });
});
