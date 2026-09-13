import { createRoutesFromElements, Navigate, Outlet, Route } from 'react-router';
import { Fragment, lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import { useSitzungsWache } from './auth/useSitzungsWache';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import FahrzeugDetailPage from './stammdaten/FahrzeugDetailPage';
import PersonalDetailPage from './stammdaten/PersonalDetailPage';
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
import EinsatzAllgemein from './pages/einstellungen/EinsatzAllgemein';
import EinsatzVerhalten from './pages/einstellungen/EinsatzVerhalten';
import EinsatzAufbewahrung from './pages/einstellungen/EinsatzAufbewahrung';
import EinsatzModule from './pages/einstellungen/EinsatzModule';
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
import AufnahmePage from './pages/personen/AufnahmePage';
import LageberichtePage from './pages/LageberichtePage';
import LageberichtDetailPage from './pages/LageberichtDetailPage';
import BefehlDetailPage from './pages/BefehlDetailPage';
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
import UnfallhilfsstellenDefault from './pages/UnfallhilfsstellenDefault';
import UhsDetailPage from './pages/uhs/UhsDetailPage';
import BereitstellungsraeumePage from './pages/bereitstellungsraum/BereitstellungsraeumePage';
import BereitstellungsraeumeDefault from './pages/bereitstellungsraum/BereitstellungsraeumeDefault';
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
import { EINSTELLUNGEN_SEKTIONEN } from './routing/deeplinks';
import LiveStatusBanner from './live/LiveStatusBanner';
import { useOfflineSync } from './offline/useOfflineSync';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';

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
  bereitstellungsraeume: <BereitstellungsraeumeDefault />,
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

/**
 * Sektions-Routen der Einsatz-Einstellungen (LFH-345 · C10, H15/M15).
 *
 * Der bare Modulpfad `…/einstellungen` — den `modulZielRoute` und damit die Modul-Navigation
 * baut — leitet auf die ERSTE Sektion um. Ohne diese Index-Route rendert das Layout mit einem
 * leeren `<Outlet>`: Reiterband über weißer Fläche, und jeder Klick aus der Navigation landete
 * dort. Das Ziel kommt aus `EINSTELLUNGEN_SEKTIONEN` statt als Literal — dieselbe Liste trägt
 * das Reiterband, ein Auseinanderlaufen ist damit ausgeschlossen (Muster `ersteSektionPfad`
 * aus `admin/adminNav`).
 *
 * `Navigate` mit RELATIVEM Ziel, weil `App` die `:id` des Einsatzes nicht kennt; react-router
 * löst es gegen die Elternroute auf. Dasselbe tut `einsatz/DefaultModulRedirect`.
 */
const EINSTELLUNGEN_ROUTEN = (
  <>
    <Route index element={<Navigate to={EINSTELLUNGEN_SEKTIONEN[0].key} replace />} />
    <Route path="allgemein" element={<EinsatzAllgemein />} />
    <Route path="verhalten" element={<EinsatzVerhalten />} />
    <Route path="aufbewahrung" element={<EinsatzAufbewahrung />} />
    <Route path="module" element={<EinsatzModule />} />
    {/* Ein unbekanntes Segment (Tippfehler, veralteter Link) trifft sonst KEIN Kind: das
        Layout stünde mit leerem `<Outlet>` da, und das Reiterband markierte trotzdem die
        erste Sektion — „Allgemein" ausgewählt über weißer Fläche. Dieselbe Regel wie bei
        `parseRouteId` und `parseEtbFilter`: Unbrauchbares wird GANZ verworfen, nicht halb
        angezeigt. Damit ist der Rückfall in `sektionAus` eine Zusicherung statt einer
        Behauptung — es gibt keinen Pfad mehr, auf dem er greifen könnte. */}
    <Route path="*" element={<Navigate to={`../${EINSTELLUNGEN_SEKTIONEN[0].key}`} replace />} />
  </>
);

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

/** Persistenter Rahmen auch für Login, globale Verwaltung und Einsatz-Routen. */
export default function App() {
  return (
    <AuthProvider>
      <CommandPaletteProvider>
        <SitzungsLayout />
      </CommandPaletteProvider>
    </AuthProvider>
  );
}

function SitzungsLayout() {
  useSitzungsWache();
  return <Outlet />;
}

/** Eine Routenquelle für Browser und Integrationstests; keine nachgelagerten Routes. */
export const appRouten = createRoutesFromElements(
  <Route element={<App />}>
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
            {/* Detailrouten der Stammdaten (LFH-346 · A7). Sie liegen IM `AdminLayout`,
                  behalten also die Sidebar — eine Detailseite ohne den Verwaltungsrahmen
                  wäre eine Sackgasse ohne Rückweg. Sie stehen NEBEN der `adminGruppen`-
                  Schleife, weil die Registry Sektionen führt, keine Detailadressen.
                  Die Reihenfolge gegenüber der Schleife ist gleichgültig: react-router 7
                  rankt nach Spezifität, `stammdaten/fahrzeuge` (statisch) schlägt
                  `stammdaten/fahrzeuge/:fahrzeugId` nicht, sondern trifft eine andere
                  Adresse — die Liste bleibt unter dem Pfad ohne id erreichbar. */}
            <Route path="stammdaten/fahrzeuge/:fahrzeugId" element={<FahrzeugDetailPage />} />
            <Route path="stammdaten/personal/:personalId" element={<PersonalDetailPage />} />
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
            >
              {/* Das Einstellungs-Modul ist seit LFH-345 · C10 ein Layout mit vier
                    Sektions-Routen. Die Kinder hängen HIER statt in einem eigenen
                    <Route path="einstellungen">, weil zwei Routen mit demselben Pfad
                    nebeneinander stünden; und nicht per Filter aus dem `map`, weil ein
                    Filter beim nächsten verschachtelten Modul still auseinanderginge. */}
              {m.key === 'einsatz-einstellungen' && EINSTELLUNGEN_ROUTEN}
            </Route>
          ))}
          <Route path="unfallhilfsstellen/liste" element={<UnfallhilfsstellenPage />} />
          <Route path="unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
          <Route path="bereitstellungsraeume/liste" element={<BereitstellungsraeumePage />} />
          <Route path="bereitstellungsraeume/:brId" element={<BrDetailPage />} />
          <Route path="lageberichte/:lbId" element={<LageberichtDetailPage />} />
          <Route path="auftraege/befehle/:befehlId" element={<BefehlDetailPage />} />
          <Route path="einheiten/:einheitId" element={<EinheitDetailPage />} />
          {/* Statisches Segment VOR der dynamischen Detail-Route. React Router rankt
                statisch ohnehin höher — die Reihenfolge steht so da, damit ein Leser das
                nicht prüfen muss (LFH-340 · C5). */}
          <Route path="personen/aufnahme" element={<AufnahmePage />} />
          <Route path="personen/:personId" element={<PersonenDetailPage />} />
          <Route path="tiere/:tierId" element={<TiereDetailPage />} />
          <Route path="schaeden/:schadenId" element={<SchaedenDetailPage />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/einsaetze" replace />} />
  </Route>,
);
