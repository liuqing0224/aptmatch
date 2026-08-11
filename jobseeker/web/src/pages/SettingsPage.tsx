import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProviderInfo, Settings } from '../types';

interface ProviderScan {
  providers: ProviderInfo[];
  detected: string;
  default: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scan, setScan] = useState<ProviderScan | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.settings.get().then(setSettings);
    api.settings.providers().then(setScan);
  }, []);

  async function save() {
    if (!settings) return;
    const next = await api.settings.update({
      defaultProvider: settings.defaultProvider,
      concurrency: Number(settings.concurrency),
      timeoutMinutes: Number(settings.timeoutMinutes),
      maxRetries: Number(settings.maxRetries),
      collectSkillDir: settings.collectSkillDir,
      collectCookiePath: settings.collectCookiePath,
    });
    setSettings(next);
    setNotice('设置已保存');
    setTimeout(() => setNotice(''), 2000);
  }

  async function rescan() {
    const next = await api.settings.providers();
    setScan(next);
    setNotice(`已扫描：检测到默认 Provider ${next.detected || '（无）'}`);
    setTimeout(() => setNotice(''), 3000);
  }

  if (!settings) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>设置</h1>
      </div>
      {notice && <div className="alert">{notice}</div>}
      <div className="card form" style={{ maxWidth: 480 }}>
        <label>
          <span>默认 Provider</span>
          <select
            value={settings.defaultProvider}
            onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value })}
          >
            <option value="codex">codex</option>
            <option value="cursor">cursor</option>
            <option value="claude">claude</option>
            <option value="opencode">opencode</option>
          </select>
          <em className="hint">
            新建 agent 时的默认值；未显式设置时自动使用扫描检测到的本地 coding agent。
          </em>
        </label>
        <label>
          <span>并发任务数</span>
          <input
            type="number"
            min={1}
            max={4}
            value={settings.concurrency}
            onChange={(e) => setSettings({ ...settings, concurrency: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>任务超时（分钟）</span>
          <input
            type="number"
            min={1}
            max={120}
            value={settings.timeoutMinutes}
            onChange={(e) => setSettings({ ...settings, timeoutMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>失败自动重试次数</span>
          <input
            type="number"
            min={0}
            max={5}
            value={settings.maxRetries}
            onChange={(e) => setSettings({ ...settings, maxRetries: Number(e.target.value) })}
          />
          <em className="hint">超时 / 进程退出 / 调度错误等可重试失败会自动回队重试，达到上限才判失败。</em>
        </label>
        <label>
          <span>飞书采集 skill 目录</span>
          <input
            value={settings.collectSkillDir}
            placeholder="例如：/Users/you/.codex/skills/feishu-recruit-collect"
            onChange={(e) => setSettings({ ...settings, collectSkillDir: e.target.value })}
          />
          <em className="hint">留空则提示 agent 自行定位 feishu-recruit-collect skill；配置后可避免硬编码路径失效。</em>
        </label>
        <label>
          <span>飞书 Cookie 文件路径</span>
          <input
            value={settings.collectCookiePath}
            placeholder="/tmp/feishu_cookies.txt"
            onChange={(e) => setSettings({ ...settings, collectCookiePath: e.target.value })}
          />
          <em className="hint">留空默认 /tmp/feishu_cookies.txt。</em>
        </label>
        <label>
          <span>数据目录</span>
          <input value={settings.dataDir} disabled />
          <em className="hint">数据库、上传文件与任务工作区都在本机此目录下。</em>
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={save}>保存设置</button>
        </div>
      </div>
      {scan && (
        <div className="card form" style={{ maxWidth: 480, marginTop: 16 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 10 }}>本地 coding agent 扫描</span>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {scan.providers.map((p) => (
              <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
                <span>
                  {p.available ? '✓' : '✗'} {p.label}（{p.id}）
                </span>
                <span className="muted">
                  {p.available ? [p.cmd, p.version].filter(Boolean).join(' · ') : '未检测到'}
                </span>
              </li>
            ))}
          </ul>
          <div className="form-actions" style={{ alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={rescan}>重新扫描</button>
            {scan.detected && scan.detected !== settings.defaultProvider && (
              <button
                className="btn"
                onClick={() => setSettings({ ...settings, defaultProvider: scan.detected })}
              >
                使用检测到的默认（{scan.detected}）
              </button>
            )}
            <em className="hint" style={{ margin: 0 }}>
              当前默认：{scan.default}
            </em>
          </div>
        </div>
      )}
    </div>
  );
}
