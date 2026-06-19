import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import StammdatenPage from './pages/StammdatenPage';
import ProfilPage from './pages/ProfilPage';
import EtbPage from './pages/EtbPage';
import ChatPage from './pages/ChatPage';
import ErinnerungenPage from './pages/ErinnerungenPage';
import AuftraegePage from './pages/AuftraegePage';
import MeldungenPage from './pages/MeldungenPage';
import NachforderungenPage from './pages/NachforderungenPage';
import LagemeldungenPage from './pages/LagemeldungenPage';
import EinsatzdatenPage from './pages/EinsatzdatenPage';
import EinsatzEinstellungenPage from './pages/EinsatzEinstellungenPage';
import FahrzeugePage from './pages/FahrzeugePage';
import MaterialPage from './pages/MaterialPage';
import PersonalPage from './pages/PersonalPage';
import EinheitenPage from './pages/EinheitenPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
import GefahrenPage from './pages/gefahren/GefahrenPage';
import PersonenPage from './pages/PersonenPage';
import LageDashboardPage from './pages/lage-dashboard/LageDashboardPage';
import TierePage from './pages/TierePage';
import SchaedenPage from './pages/SchaedenPage';
import LageberichtePage from './pages/LageberichtePage';
import LageberichtDetailPage from './pages/LageberichtDetailPage';
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
import UnfallhilfsstellenDefault from './pages/UnfallhilfsstellenDefault';
import UhsDetailPage from './pages/uhs/UhsDetailPage';
import BereitstellungsraeumePage from './pages/bereitstellungsraum/BereitstellungsraeumePage';
import BrDetailPage from './pages/bereitstellungsraum/BrDetailPage';
import EinsatzLayout from './einsatz/EinsatzLayout';
import DefaultModulRedirect from './einsatz/DefaultModulRedirect';
import ModulRedirect from './einsatz/ModulRedirect';
import ModulStub from './einsatz/ModulStub';
import { modulRegistry } from './einsatz/modulRegistry';

const LagekartePage = lazy(() => import('./pages/LagekartePage'));
const KraefteuebersichtPage = lazy(() => import('./pages/KraefteuebersichtPage'));

/**
 * Module mit echter Implementierung; alle übrigen rendern den ModulStub.
 * Gekeyt nach `ModulEintrag.key` (nicht nach `route`!) — bei `gefahrenzonen`
 * weichen key (`gefahrenzonen`) und route (`gefahren`) ab; das Element muss
 * unter dem key stehen, sonst greift der Stub-Fallback.
 */
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  'lage-dashboard': <LageDashboardPage />,
  etb: <EtbPage />,
  chat: <ChatPage />,
  erinnerungen: <ErinnerungenPage />,
  auftraege: <AuftraegePage />,
  meldungen: <MeldungenPage />,
  nachforderungen: <NachforderungenPage />,
  lagemeldungen: <LagemeldungenPage />,
  einsatzdaten: <EinsatzdatenPage />,
  'einsatz-einstellungen': <EinsatzEinstellungenPage />,
  fahrzeuge: <FahrzeugePage />,
  material: <MaterialPage />,
  personal: <PersonalPage />,
  einheiten: <EinheitenPage />,
  einsatzabschnitte: <EinsatzabschnittePage />,
  personen: <PersonenPage />,
  unfallhilfsstellen: <UnfallhilfsstellenDefault />,
  bereitstellungsraeume: <BereitstellungsraeumePage />,
  tiere: <TierePage />,
  schaeden: <SchaedenPage />,
  lageberichte: <LageberichtePage />,
  lagekarte: (
    <Suspense fallback={<div style={{ padding: 24 }}>Karte wird geladen…</div>}>
      <LagekartePage />
    </Suspense>
  ),
  kraefteuebersicht: (
    <Suspense fallback={<div style={{ padding: 24 }}>Meldebild wird geladen…</div>}>
      <KraefteuebersichtPage />
    </Suspense>
  ),
  gefahrenzonen: <GefahrenPage />,
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
              element={
                m.verweistAuf
                  ? <ModulRedirect to={m.verweistAuf} />
                  : MODUL_ELEMENTE[m.key] ?? <ModulStub modul={m} />
              }
            />
          ))}
          <Route path="unfallhilfsstellen/liste" element={<UnfallhilfsstellenPage />} />
          <Route path="unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
          <Route path="bereitstellungsraeume/:brId" element={<BrDetailPage />} />
          <Route path="lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
