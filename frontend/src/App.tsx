import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import StammdatenPage from './pages/StammdatenPage';
import ProfilPage from './pages/ProfilPage';
import EtbPage from './pages/EtbPage';
import EinsatzdatenPage from './pages/EinsatzdatenPage';
import FahrzeugePage from './pages/FahrzeugePage';
import MaterialPage from './pages/MaterialPage';
import PersonalPage from './pages/PersonalPage';
import EinheitenPage from './pages/EinheitenPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
import PersonenPage from './pages/PersonenPage';
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
import UhsDetailPage from './pages/uhs/UhsDetailPage';
import EinsatzLayout from './einsatz/EinsatzLayout';
import DefaultModulRedirect from './einsatz/DefaultModulRedirect';
import ModulStub from './einsatz/ModulStub';
import { modulRegistry } from './einsatz/modulRegistry';

/** Module mit echter Implementierung; alle übrigen rendern den ModulStub. */
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  einsatzdaten: <EinsatzdatenPage />,
  fahrzeuge: <FahrzeugePage />,
  material: <MaterialPage />,
  personal: <PersonalPage />,
  einheiten: <EinheitenPage />,
  einsatzabschnitte: <EinsatzabschnittePage />,
  personen: <PersonenPage />,
  unfallhilfsstellen: <UnfallhilfsstellenPage />,
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* Ebene 1 — globale Shell */}
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          <Route path="/benutzer" element={<BenutzerPage />} />
          <Route path="/stammdaten" element={<StammdatenPage />} />
          <Route path="/profil" element={<ProfilPage />} />
        </Route>
        {/* Ebene 2 — Einsatz-Workspace */}
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route index element={<DefaultModulRedirect />} />
          {modulRegistry.map((m) => (
            <Route
              key={m.key}
              path={m.route}
              element={MODUL_ELEMENTE[m.key] ?? <ModulStub modul={m} />}
            />
          ))}
          <Route path="unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
