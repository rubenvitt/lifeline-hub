import { createRoutesFromElements, Navigate, Outlet, Route } from 'react-router';
import { Fragment, lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import { useSitzungsWache } from './auth/useSitzungsWache';
import BenutzerKonfliktDialog from './auth/BenutzerKonfliktDialog';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import AppAnmeldungPage from './pages/AppAnmeldungPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import FahrzeugDetailPage from './stammdaten/FahrzeugDetailPage';
import PersonalDetailPage from './stammdaten/PersonalDetailPage';
import ProfilPage from './pages/ProfilPage';
import EtbPage from './pages/EtbPage';
import EtbDruckPage from './pages/EtbDruckPage';
import EinsatzberichtDruckPage from './pages/EinsatzberichtDruckPage';
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
import EinsatzPegel from './pages/einstellungen/EinsatzPegel';
import FahrzeugePage from './pages/FahrzeugePage';
import MaterialPage from './pages/MaterialPage';
import PersonalPage from './pages/PersonalPage';
import EinheitenPage from './pages/EinheitenPage';
import EinheitDetailPage from './pages/EinheitDetailPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
import GefahrenPage from './pages/gefahren/GefahrenPage';
import PersonenPage from './pages/PersonenPage';
import LageDashboardPage from './pages/lage-dashboard/LageDashboardPage';
import UeberblickPage from './pages/fuehrung/UeberblickPage';
import TierePage from './pages/TierePage';
import TiereDetailPage from './pages/TiereDetailPage';
import SchaedenPage from './pages/SchaedenPage';
import DokumentePage from './pages/DokumentePage';
import StabPage from './pages/StabPage';
import FunkplanPage from './pages/FunkplanPage';
import InfotelefonPage from './pages/InfotelefonPage';
import PressePage from './pages/PressePage';
import PressemitteilungDetailPage from './pages/PressemitteilungDetailPage';
import AbloesungPage from './pages/AbloesungPage';
import BetreuungPage from './pages/BetreuungPage';
import VerpflegungPage from './pages/VerpflegungPage';
import WetterPegelPage from './pages/WetterPegelPage';
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
import DemoDatenPage from './admin/DemoDatenPage';
import AufbewahrungUebersicht from './aufbewahrung/AufbewahrungUebersicht';
import ArchivAktePage from './aufbewahrung/ArchivAktePage';
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
import { abgleichFuer, useOfflineSync } from './offline/useOfflineSync';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';

const LagekartePage = lazy(() => import('./pages/LagekartePage'));
const KraefteuebersichtPage = lazy(() => import('./pages/KraefteuebersichtPage'));

/**
 * Module mit echter Implementierung; alle übrigen rendern den ModulStub.
 * Gekeyt nach `ModulEintrag.key`, nicht nach `route` — bei `gefahrenzonen` weichen beide ab.
 */
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  ueberblick: <UeberblickPage />,
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
  verpflegung: <VerpflegungPage />,
  personal: <PersonalPage />,
  einheiten: <EinheitenPage />,
  einsatzabschnitte: <EinsatzabschnittePage />,
  stab: <StabPage />,
  dokumente: <DokumentePage />,
  abloesung: <AbloesungPage />,
  'wetter-pegel': <WetterPegelPage />,
  personen: <PersonenPage />,
  unfallhilfsstellen: <UnfallhilfsstellenDefault />,
  betreuung: <BetreuungPage />,
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
 * Sektions-Routen der Einsatz-Einstellungen. Der bare Pfad `…/einstellungen` (Ziel von
 * `modulZielRoute`) leitet auf die erste Sektion aus `EINSTELLUNGEN_SEKTIONEN` um, sonst
 * stünde das Layout mit leerem `<Outlet>` da. `Navigate` relativ, weil `App` die `:id` nicht kennt.
 */
const EINSTELLUNGEN_ROUTEN = (
  <>
    <Route index element={<Navigate to={EINSTELLUNGEN_SEKTIONEN[0].key} replace />} />
    <Route path="allgemein" element={<EinsatzAllgemein />} />
    <Route path="verhalten" element={<EinsatzVerhalten />} />
    <Route path="aufbewahrung" element={<EinsatzAufbewahrung />} />
    <Route path="module" element={<EinsatzModule />} />
    <Route path="pegel" element={<EinsatzPegel />} />
    {/* Unbekanntes Segment → erste Sektion, statt ein leeres `<Outlet>` unter markiertem Reiter. */}
    <Route path="*" element={<Navigate to={`../${EINSTELLUNGEN_SEKTIONEN[0].key}`} replace />} />
  </>
);

/**
 * Genau eine Betriebszeile für alle angemeldeten Routen; globale Topbar und
 * Einsatz-Workspace bleiben darunter Geschwister.
 */
function BetriebsLayout() {
  const { benutzer, konflikt } = useAuth();
  useOfflineSync(abgleichFuer(benutzer, konflikt !== null));
  return (
    <>
      <LiveStatusBanner benutzerId={benutzer?.id} />
      <Outlet />
    </>
  );
}

/** Persistenter Rahmen auch für Login, globale Verwaltung und Einsatz-Routen. */
function App() {
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
  return (
    <>
      <Outlet />
      {/* Benutzerwechsel in einem anderen Tab (LFH-387) — neben der Wache, über jeder Route. */}
      <BenutzerKonfliktDialog />
    </>
  );
}

/** Eine Routenquelle für Browser und Integrationstests; keine nachgelagerten Routes. */
export const appRouten = createRoutesFromElements(
  <Route element={<App />}>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      {/* Bestätigung im Systembrowser für die Mac-App (LFH-818): ohne Rahmen, wie die Anmeldung. */}
      <Route path="/app-anmeldung" element={<AppAnmeldungPage />} />
      <Route element={<BetriebsLayout />}>
        {/* Ebene 1 — globale Shell */}
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          {/* Alt-Link bleibt als Redirect in die Admin-Sidebar. */}
          <Route path="/benutzer" element={<Navigate to={adminBenutzerPfad()} replace />} />
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
            {/* Demo-Daten (LFH-690): die Seite schützt sich selbst (System-Admin UND Status 200). */}
            <Route path="demo-daten" element={<DemoDatenPage />} />
            {/* Aufbewahrung (LFH-23): nur für den System-Admin, beide Seiten schützen sich selbst;
               eine ungültige id leitet auf die Übersicht. */}
            <Route path="aufbewahrung" element={<AufbewahrungUebersicht />} />
            <Route path="aufbewahrung/:einsatzId" element={<ArchivAktePage />} />
            {/* Stammdaten-Detailrouten liegen IM `AdminLayout`, damit die Sidebar als Rückweg bleibt,
               und neben der `adminGruppen`-Schleife, weil die Registry keine Detailadressen führt. */}
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
              {/* Die Einstellungs-Sektionen hängen HIER statt unter einem eigenen
                 <Route path="einstellungen">, sonst stünden zwei Routen mit demselben Pfad nebeneinander. */}
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
          {/* Statisches Segment vor der dynamischen Detail-Route (React Router rankt ohnehin statisch höher). */}
          <Route path="personen/aufnahme" element={<AufnahmePage />} />
          {/* ETB-Druckansicht (LFH-22), Filter aus der Adresse. */}
          <Route path="etb/druck" element={<EtbDruckPage />} />
          {/* Einsatzbericht (LFH-726): Unterroute der Einsatzdaten, die nie ausgeblendet oder
              gesperrt sind; die Rechte prüft der Bericht je Quelle selbst. */}
          <Route path="einsatzdaten/bericht" element={<EinsatzberichtDruckPage />} />
          {/* Funkplan S6 (LFH-548): Unterroute des Stabs, kein Modul; `modulAusPfad` markiert den
              Stab, Sperre und Sichtbarkeit kommen vom Stab. */}
          <Route path="stab/funkplan" element={<FunkplanPage />} />
          {/* Presse- und Medienarbeit S5 (LFH-554): Unterrouten des Stabs wie der Funkplan. */}
          <Route path="stab/presse" element={<PressePage />} />
          <Route
            path="stab/presse/mitteilungen/:mitteilungId"
            element={<PressemitteilungDetailPage />}
          />
          <Route path="stab/infotelefon" element={<InfotelefonPage />} />
          <Route path="personen/:personId" element={<PersonenDetailPage />} />
          <Route path="tiere/:tierId" element={<TiereDetailPage />} />
          <Route path="schaeden/:schadenId" element={<SchaedenDetailPage />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/einsaetze" replace />} />
  </Route>,
);
