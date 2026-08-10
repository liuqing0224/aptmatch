import { Link, Outlet, useLocation } from 'react-router-dom';

export default function Layout() {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get('tab') ?? '';
  const workspaceClass = (target: string) =>
    `nav-link${location.pathname === '/' && tab === target ? ' active' : ''}`;

  return (
    <div className="app-shell recruit-shell">
      <aside className="sidebar recruit-sidebar">
        <div className="brand">
          <span className="brand-mark recruit-brand-mark">R</span>
          <div>
            <div className="brand-title">AptMatch Recruit</div>
            <div className="brand-sub">招聘端 · 人才 × 职位</div>
          </div>
        </div>
        <nav className="nav">
          <Link to="/" className={workspaceClass('')}>职位与 JD</Link>
          <Link to="/?tab=candidates" className={workspaceClass('candidates')}>候选人库</Link>
          <Link to="/?tab=guide" className={workspaceClass('guide')}>采集流程</Link>
        </nav>
        <div className="sidebar-foot">招聘端 · 独立数据库</div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
