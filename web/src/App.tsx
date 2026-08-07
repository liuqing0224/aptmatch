import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Board from './pages/Board';
import NewMatch from './pages/NewMatch';
import Report from './pages/Report';
import Resources from './pages/Resources';
import Agents from './pages/Agents';
import Compare from './pages/Compare';
import SettingsPage from './pages/SettingsPage';
import Blacklist from './pages/Blacklist';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<Board />} />
        <Route path="/new" element={<NewMatch />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/blacklist" element={<Blacklist />} />
        <Route path="/tasks/:id" element={<Report />} />
      </Route>
    </Routes>
  );
}
