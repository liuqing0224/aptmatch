import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useResourceStore } from '../store';

function FileInput({ onChange, disabled }: { onChange: (f: File | null) => void; disabled?: boolean }) {
  return (
    <input
      type="file"
      accept=".pdf,.docx,.txt,.md"
      disabled={disabled}
      onChange={(e) => onChange(e.target.files?.[0] ?? null)}
    />
  );
}

export default function Resources() {
  const [tab, setTab] = useState<'resumes' | 'companies'>('resumes');
  const resumes = useResourceStore((s) => s.resumes);
  const companies = useResourceStore((s) => s.companies);
  const ensureLoaded = useResourceStore((s) => s.ensureLoaded);
  const addResume = useResourceStore((s) => s.addResume);
  const addCompany = useResourceStore((s) => s.addCompany);
  const removeResume = useResourceStore((s) => s.removeResume);
  const removeCompany = useResourceStore((s) => s.removeCompany);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseMsg, setParseMsg] = useState('');

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

  useEffect(() => {
    ensureLoaded().catch((e) => setError(e.message));
  }, [ensureLoaded]);

  async function submitResume(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData();
    if (rName.trim()) form.append('name', rName.trim());
    if (rText.trim()) form.append('text', rText);
    if (rFile) form.append('file', rFile);
    try {
      const resume = await api.resumes.create(form);
      addResume(resume);
      setRName('');
      setRText('');
      setRFile(null);
      setParseMsg('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // 选择简历文件后自动解析，回填姓名与简历全文（可继续编辑）
  async function onResumeFile(f: File | null) {
    setRFile(f);
    if (!f) return;
    setParseBusy(true);
    setParseMsg('正在解析简历…');
    try {
      const { name, text } = await api.resumes.parse(f);
      if (!rName.trim()) setRName(name);
      setRText(text);
      setParseMsg(`已自动填入：姓名「${name || '未识别，请手动填写'}」，全文 ${text.length} 字（可编辑后再保存）`);
    } catch (err) {
      setParseMsg(err instanceof ApiError ? `解析失败：${err.message}` : String(err));
    } finally {
      setParseBusy(false);
    }
  }

  async function submitCompany(e: React.FormEvent) {
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
      const company = await api.companies.create(form);
      addCompany(company);
      setCName('');
      setCIndustry('');
      setCStage('');
      setCUrl('');
      setCJd('');
      setCFile(null);
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
          <form className="card form" onSubmit={submitResume}>
            <h2>新增简历</h2>
            <label><span>名称</span><input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="例如：张三-前端-5年" /></label>
            <label><span>粘贴简历文本</span><textarea rows={8} value={rText} onChange={(e) => setRText(e.target.value)} placeholder="粘贴简历全文…" /></label>
            <label><span>或上传文件（PDF/DOCX/TXT）</span><FileInput onChange={onResumeFile} disabled={parseBusy} /></label>
            {parseMsg && <p className="muted">{parseMsg}</p>}
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy || parseBusy}>保存简历</button>
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
                <button className="btn btn-sm btn-danger" onClick={() => removeResume(r.id).catch((e) => setError(e.message))}>删除</button>
              </div>
            ))}
            {resumes.length === 0 && <div className="empty">暂无简历</div>}
          </div>
        </div>
      )}

      {tab === 'companies' && (
        <div className="grid-2">
          <form className="card form" onSubmit={submitCompany}>
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
                <button className="btn btn-sm btn-danger" onClick={() => removeCompany(c.id).catch((e) => setError(e.message))}>删除</button>
              </div>
            ))}
            {companies.length === 0 && <div className="empty">暂无公司资料</div>}
          </div>
        </div>
      )}
    </div>
  );
}
