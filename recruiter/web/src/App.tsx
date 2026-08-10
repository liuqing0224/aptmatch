import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Recruit from './pages/Recruit';
import Report from './pages/Report';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Recruit />} />
        <Route path="/tasks/:id" element={<Report />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
