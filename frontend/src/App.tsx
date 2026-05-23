import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './routes/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import EtbPage from './pages/EtbPage';
import BenutzerPage from './pages/BenutzerPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
          <Route path="/benutzer" element={<BenutzerPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
