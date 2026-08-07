import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Company, Resume } from '../types';

function FileInput({ onChange }: { onChange: (f: File | null) => void }) {
  return (
    <input
      type="file"
      accept=".pdf,.docx,.txt,.md"
      onChange={(e) => onChange(e.target.files?.[0] ?? null)}
    />
  );
}

export default function Resources() {
  const [tab, setTab] = useState<'resumes' | 'companies'>('resumes');
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 简历表单
  const [rName, setRName] = useState('');
  const [rText, setRText] = useState('');
  const [rFile, setRFile] = useState<File | null>(null);

  // 公司表单
  const [cName, setCName] = useState('');
  const [cIndustry, setCIndustry] = useState('');
  const [cStage, setCStage] = useState('');
  const [cUrl, setCUrl] = useState('');
  const [cJd, setCJd] = useState('');
  const [cFile, setCFile] = useState<File | null>(null);

  async function refresh() {
    const [r, c] = await Promise.all([api.resumes.list(), api.companies.list()]);
    setResumes(r);
    setCompanies(c);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function addResume(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData();
    if (rName.trim()) form.append('name', rName.trim());
    if (rText.trim()) form.append('text', rText);
    if (rFile) form.append('file', rFile);
    try {
      await api.resumes.create(form);
      setRName('');
      setRText('');
      setRFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('name', cName.trim());
    if (cIndustry.trim()) form.append('industry', cIndustry.trim());
    if (cStage.trim()) form.append('stage', cStage.trim());
    if (cUrl.trim()) form.append('url', cUrl.trim());
    if (cJd.trim()) form.append('jd_text', cJd);
    if (cFile) form.append('file', cFile);
    try {
      await api.companies.create(form);
      setCName('');
      setCIndustry('');
      setCStage('');
      setCUrl('');
      setCJd('');
      setCFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>简历与公司</h1>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="tabs">
        <button className={tab === 'resumes' ? 'tab active' : 'tab'} onClick={() => setTab('resumes')}>
          简历（{resumes.length}）
        </button>
        <button className={tab === 'companies' ? 'tab active' : 'tab'} onClick={() => setTab('companies')}>
          公司（{companies.length}）
        </button>
      </div>

      {tab === 'resumes' && (
        <div className="grid-2">
          <form className="card form" onSubmit={addResume}>
            <h2>新增简历</h2>
            <label><span>名称</span><input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="例如：张三-前端-5年" /></label>
            <label><span>粘贴简历文本</span><textarea rows={8} value={rText} onChange={(e) => setRText(e.target.value)} placeholder="粘贴简历全文…" /></label>
            <label><span>或上传文件（PDF/DOCX/TXT）</span><FileInput onChange={setRFile} /></label>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy}>保存简历</button>
            </div>
          </form>
          <div className="list-pane">
            {resumes.map((r) => (
              <div className="card list-item" key={r.id}>
                <div className="list-item-head">
                  <strong>{r.name}</strong>
                  <span className="muted">{new Date(r.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
                <p className="preview">{r.text.slice(0, 160)}{r.text.length > 160 ? '…' : ''}</p>
                <button className="btn btn-sm btn-danger" onClick={async () => { await api.resumes.remove(r.id); refresh(); }}>删除</button>
              </div>
            ))}
            {resumes.length === 0 && <div className="empty">暂无简历</div>}
          </div>
        </div>
      )}

      {tab === 'companies' && (
        <div className="grid-2">
          <form className="card form" onSubmit={addCompany}>
            <h2>新增公司与岗位</h2>
            <label><span>公司名 *</span><input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="公司名称" /></label>
            <div className="form-row">
              <label><span>行业</span><input value={cIndustry} onChange={(e) => setCIndustry(e.target.value)} placeholder="互联网 / 金融…" /></label>
              <label><span>阶段</span><input value={cStage} onChange={(e) => setCStage(e.target.value)} placeholder="初创 / 成长 / 成熟…" /></label>
            </div>
            <label><span>官网/招聘链接</span><input value={cUrl} onChange={(e) => setCUrl(e.target.value)} placeholder="https://…（用于 agent 联网调研）" /></label>
            <label><span>粘贴职位描述（JD）</span><textarea rows={8} value={cJd} onChange={(e) => setCJd(e.target.value)} placeholder="粘贴 JD 全文…" /></label>
            <label><span>或上传 JD 文件（PDF/DOCX/TXT）</span><FileInput onChange={setCFile} /></label>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy}>保存公司</button>
            </div>
          </form>
          <div className="list-pane">
            {companies.map((c) => (
              <div className="card list-item" key={c.id}>
                <div className="list-item-head">
                  <strong>{c.name}</strong>
                  <span className="muted">{c.industry} {c.stage}</span>
                </div>
                {c.url && <a className="company-url" href={c.url} target="_blank" rel="noreferrer">{c.url}</a>}
                <p className="preview">{c.jd_text.slice(0, 160)}{c.jd_text.length > 160 ? '…' : ''}</p>
                <button className="btn btn-sm btn-danger" onClick={async () => { await api.companies.remove(c.id); refresh(); }}>删除</button>
              </div>
            ))}
            {companies.length === 0 && <div className="empty">暂无公司资料</div>}
          </div>
        </div>
      )}
    </div>
  );
}
