import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 支持的本地 coding agent CLI，按默认偏好排序（先检测到谁，谁就是默认 Provider）。 */
export const PROVIDERS = [
  { id: 'codex', label: 'Codex', cmd: 'codex' },
  { id: 'cursor', label: 'Cursor', cmd: 'cursor' },
  { id: 'claude', label: 'Claude', cmd: 'claude' },
  { id: 'opencode', label: 'OpenCode', cmd: 'opencode' },
];

// PATH 中找不到时也会检查的常见安装位置（如 ~/.local/bin、~/.codex/bin、~/.opencode/bin）
const FALLBACK_BINS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.codex', 'bin'),
  path.join(os.homedir(), '.opencode', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

function which(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf8', timeout: 2000 });
  if (r.status === 0) {
    const hit = (r.stdout || '').trim().split('\n')[0];
    if (hit) return hit;
  }
  for (const dir of FALLBACK_BINS) {
    const p = path.join(dir, cmd);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* 不存在 */
    }
  }
  return null;
}

function versionOf(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000 });
  if (r.status !== 0) return null;
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || null;
}

let cache = null;

/**
 * 扫描本机已安装的 coding agent CLI（PATH + 常见安装位置）。
 * 未注入自定义探测函数时结果会缓存，供 settings / 种子 agent 复用。
 */
export function scanProviders({ whichCmd = which, versionCmd = versionOf, force = false } = {}) {
  const injected = whichCmd !== which || versionCmd !== versionOf;
  if (!force && !injected && cache) return cache;
  const providers = PROVIDERS.map(({ id, label, cmd }) => {
    const bin = whichCmd(cmd);
    return {
      id,
      label,
      available: bin !== null,
      cmd: bin,
      version: bin ? versionCmd(cmd) : null,
    };
  });
  if (!injected) cache = providers;
  return providers;
}

/** 按 PROVIDERS 顺序返回第一个可用的 provider；都没有时返回 null。 */
export function detectDefaultProvider(scanned = scanProviders()) {
  return scanned.find((p) => p.available)?.id ?? null;
}

export function buildCommand(provider, { workspace, prompt, model }) {
  switch (provider) {
    case 'codex': {
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-s',
        'danger-full-access',
        '-C',
        workspace,
      ];
      if (model) args.push('-m', model);
      args.push(prompt);
      return { cmd: 'codex', args, cwd: workspace };
    }
    case 'cursor': {
      const args = [
        'agent',
        '-p',
        '--workspace',
        workspace,
        '--force',
        '--output-format',
        'json',
      ];
      if (model) args.push('--model', model);
      args.push(prompt);
      return { cmd: 'cursor', args, cwd: workspace };
    }
    case 'claude': {
      const args = [
        '-p',
        '--output-format',
        'json',
        '--allowedTools',
        'Read Write Edit WebFetch WebSearch Bash Glob Grep',
        '--dangerously-skip-permissions',
      ];
      if (model) args.push('--model', model);
      args.push(prompt);
      return { cmd: 'claude', args, cwd: workspace };
    }
    case 'opencode': {
      const args = ['run', '--dir', workspace, '--auto'];
      if (model) args.push('--model', model);
      args.push(prompt);
      return { cmd: 'opencode', args, cwd: workspace };
    }
    default:
      throw new Error(`未知 provider: ${provider}`);
  }
}
