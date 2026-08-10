import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/board', label: '看板' },
  { to: '/new', label: '新建匹配' },
  { to: '/compare', label: '对比' },
  { to: '/resources', label: '简历与公司' },
  { to: '/agents', label: 'Agent 管理' },
  { to: '/settings', label: '设置' },
  { to: '/blacklist', label: '黑名单' },
];

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="brand-title">AptMatch</div>
            <div className="brand-sub">求职端 · 简历 × 岗位</div>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">求职端 · 数据保存在本机</div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
