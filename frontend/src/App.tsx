import { Navigate, Outlet, Route, Routes } from 'react-router';
import { Fragment, lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import { useSitzungsWache } from './auth/useSitzungsWache';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
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
import EinheitDetailPage from './pages/EinheitDetailPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
import GefahrenPage from './pages/gefahren/GefahrenPage';
import PersonenPage from './pages/PersonenPage';
import LageDashboardPage from './pages/lage-dashboard/LageDashboardPage';
import TierePage from './pages/TierePage';
import TiereDetailPage from './pages/TiereDetailPage';
import SchaedenPage from './pages/SchaedenPage';
import SchaedenDetailPage from './pages/SchaedenDetailPage';
import PersonenDetailPage from './pages/PersonenDetailPage';
import LageberichtePage from './pages/LageberichtePage';
import LageberichtDetailPage from './pages/LageberichtDetailPage';
import BefehlDetailPage from './pages/BefehlDetailPage';
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
import UnfallhilfsstellenDefault from './pages/UnfallhilfsstellenDefault';
import UhsDetailPage from './pages/uhs/UhsDetailPage';
import BereitstellungsraeumePage from './pages/bereitstellungsraum/BereitstellungsraeumePage';
import BrDetailPage from './pages/bereitstellungsraum/BrDetailPage';
import AdminLayout from './admin/AdminLayout';
import {
  adminGruppen,
  adminBenutzerPfad,
  defaultAdminPfad,
  ersteSektionPfad,
} from './admin/adminNav';
import EinsatzLayout from './einsatz/EinsatzLayout';
import DefaultModulRedirect from './einsatz/DefaultModulRedirect';
import ModulRedirect from './einsatz/ModulRedirect';
import ModulStub from './einsatz/ModulStub';
import { modulRegistry } from './einsatz/modulRegistry';
import LiveStatusBanner from './live/LiveStatusBanner';
import { useOfflineSync } from './offline/useOfflineSync';
import { useAuth } from './auth/AuthContext';

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
    <Suspense
      fallback={<div style={{ padding: 'var(--lfh-seiten-polsterung)' }}>Karte wird geladen…</div>}
    >
      <LagekartePage />
    </Suspense>
  ),
  kraefteuebersicht: (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--lfh-seiten-polsterung)' }}>Meldebild wird geladen…</div>
      }
    >
      <KraefteuebersichtPage />
    </Suspense>
  ),
  gefahrenzonen: <GefahrenPage />,
};

/** Genau eine Betriebszeile für alle angemeldeten Routen. Die beiden vorhandenen
 *  Layout-Zweige (globale Topbar und Einsatz-Workspace) bleiben darunter Geschwister. */
function BetriebsLayout() {
  const { benutzer } = useAuth();
  useOfflineSync(benutzer?.id);
  return (
    <>
      <LiveStatusBanner benutzerId={benutzer?.id} />
      <Outlet />
    </>
  );
}

export default function App() {
  // Zentrale 401-Behandlung (LFH-268/F24): hier und nicht tiefer, weil App die oberste
  // Komponente innerhalb von AntApp, BrowserRouter und AuthProvider ist — damit greift der
  // Re-Login-Pfad auch auf /admin, /profil, den Stammdaten und der Einsatzliste.
  useSitzungsWache();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<BetriebsLayout />}>
          {/* Ebene 1 — globale Shell */}
          <Route element={<AppLayout />}>
            <Route path="/einsaetze" element={<EinsaetzePage />} />
            {/* Benutzer-Verwaltung wohnt jetzt in der Admin-Sidebar; Alt-Link bleibt als Redirect. */}
            <Route path="/benutzer" element={<Navigate to={adminBenutzerPfad()} replace />} />
            {/* Alt-Route bleibt für externe Links / EinsatzSwitcher erhalten */}
            <Route path="/stammdaten" element={<Navigate to="/admin/stammdaten" replace />} />
            <Route path="/profil" element={<ProfilPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to={defaultAdminPfad()} replace />} />
              {adminGruppen.map((g) => (
                <Fragment key={g.key}>
                  {/* Gruppen-Bare-Pfad → erste Sektion (z. B. /admin/stammdaten → …/stichworte). */}
                  <Route path={g.key} element={<Navigate to={ersteSektionPfad(g.key)} replace />} />
                  {g.sektionen.map((s) => (
                    <Route key={s.key} path={`${g.key}/${s.key}`} element={s.element} />
                  ))}
                </Fragment>
              ))}
              <Route path="benutzer" element={<BenutzerPage />} />
            </Route>
          </Route>
          {/* Ebene 2 — Einsatz-Workspace */}
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route index element={<DefaultModulRedirect />} />
            {modulRegistry.map((m) => (
              <Route
                key={m.key}
                path={m.route}
                element={
                  m.verweistAuf ? (
                    <ModulRedirect to={m.verweistAuf} />
                  ) : (
                    (MODUL_ELEMENTE[m.key] ?? <ModulStub modul={m} />)
                  )
                }
              />
            ))}
            <Route path="unfallhilfsstellen/liste" element={<UnfallhilfsstellenPage />} />
            <Route path="unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
            <Route path="bereitstellungsraeume/:brId" element={<BrDetailPage />} />
            <Route path="lageberichte/:lbId" element={<LageberichtDetailPage />} />
            <Route path="auftraege/befehle/:befehlId" element={<BefehlDetailPage />} />
            <Route path="einheiten/:einheitId" element={<EinheitDetailPage />} />
            <Route path="personen/:personId" element={<PersonenDetailPage />} />
            <Route path="tiere/:tierId" element={<TiereDetailPage />} />
            <Route path="schaeden/:schadenId" element={<SchaedenDetailPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
