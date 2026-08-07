import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Agent } from '../types';
import Markdown from '../components/Markdown';

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [profile, setProfile] = useState('');
  const [profileDirty, setProfileDirty] = useState(false);
  const [skills, setSkills] = useState<{ name: string; content: string }[]>([]);
  const [activeSkill, setActiveSkill] = useState<string>('');
  const [skillContent, setSkillContent] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('codex');
  const [newModel, setNewModel] = useState('');

  async function refresh() {
    const list = await api.agents.list();
    setAgents(list);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    api.agents.profile(selectedId).then(setProfile).catch((e) => setError(e.message));
    api.agents.skills(selectedId).then((s) => {
      setSkills(s);
      if (s.length > 0) {
        setActiveSkill(s[0].name);
        setSkillContent(s[0].content);
      }
    }).catch((e) => setError(e.message));
    setProfileDirty(false);
  }, [selectedId]);

  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    try {
      const agent = await api.agents.create({ name: newName, provider: newProvider, model: newModel });
      setNewName('');
      setNewModel('');
      await refresh();
      setSelectedId(agent.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function saveProfile() {
    if (!selectedId) return;
    await api.agents.saveProfile(selectedId, profile);
    setProfileDirty(false);
    setNotice('档案已保存');
    setTimeout(() => setNotice(''), 2000);
  }

  async function saveSkill() {
    if (!selectedId || !activeSkill) return;
    await api.agents.saveSkill(selectedId, activeSkill, skillContent);
    setNotice('技能已保存');
    setTimeout(() => setNotice(''), 2000);
  }

  async function createSkill() {
    const name = window.prompt('新技能文件名（英文，如 teamwork-analysis.md）');
    if (!name || !selectedId) return;
    await api.agents.createSkill(selectedId, name, '');
    const s = await api.agents.skills(selectedId);
    setSkills(s);
    setActiveSkill(s.find((x) => x.name === name)?.name ?? '');
    setSkillContent('');
  }

  return (
    <div>
      <div className="page-head">
        <h1>Agent 管理</h1>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      <div className="card form">
        <h2>新建 Agent</h2>
        <form className="form-row" onSubmit={createAgent}>
          <label><span>名称</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：行业研究 agent" /></label>
          <label><span>Provider</span>
            <select value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
              <option value="codex">codex</option>
              <option value="cursor">cursor</option>
              <option value="claude">claude</option>
            </select>
          </label>
          <label><span>模型（可选）</span><input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="留空用默认" /></label>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} disabled={!newName.trim()}>创建</button>
        </form>
      </div>

      <div className="agent-layout">
        <div className="agent-list">
          {agents.map((a) => (
            <button
              key={a.id}
              className={`agent-item${a.id === selectedId ? ' active' : ''}`}
              onClick={() => setSelectedId(a.id)}
            >
              <strong>{a.name}</strong>
              <span className="muted">{a.provider}{a.model ? ` · ${a.model}` : ''}</span>
            </button>
          ))}
        </div>

        {selectedId && (
          <div className="card agent-editor">
            <div className="page-head">
              <h2>{agents.find((a) => a.id === selectedId)?.name}</h2>
              <div>
                <button className="btn" onClick={saveProfile} disabled={!profileDirty}>保存档案</button>
              </div>
            </div>
            <div className="tabs">
              <button className="tab active">档案 AGENTS.md</button>
              <button
                className="tab"
                onClick={async () => {
                  await saveProfile();
                }}
              >
                技能（{skills.length}）
              </button>
            </div>
            <textarea
              className="code-box"
              rows={18}
              value={profile}
              onChange={(e) => { setProfile(e.target.value); setProfileDirty(true); }}
            />
            <details>
              <summary>预览渲染效果</summary>
              <Markdown>{profile}</Markdown>
            </details>

            <h2 style={{ marginTop: 24 }}>技能沉淀</h2>
            <div className="skill-layout">
              <div className="skill-list">
                {skills.map((s) => (
                  <button
                    key={s.name}
                    className={`agent-item${s.name === activeSkill ? ' active' : ''}`}
                    onClick={() => { setActiveSkill(s.name); setSkillContent(s.content); }}
                  >
                    {s.name}
                  </button>
                ))}
                <button className="btn btn-sm" onClick={createSkill}>+ 新技能</button>
              </div>
              <div className="skill-editor">
                {activeSkill ? (
                  <>
                    <div className="page-head">
                      <strong>{activeSkill}</strong>
                      <button className="btn btn-sm btn-primary" onClick={saveSkill}>保存技能</button>
                    </div>
                    <textarea className="code-box" rows={12} value={skillContent} onChange={(e) => setSkillContent(e.target.value)} />
                  </>
                ) : (
                  <div className="empty">暂无技能</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
