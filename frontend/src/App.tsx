import { createRoutesFromElements, Navigate, Outlet, Route } from 'react-router';
import { Fragment, lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import { useSitzungsWache } from './auth/useSitzungsWache';
import BenutzerKonfliktDialog from './auth/BenutzerKonfliktDialog';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import AppAnmeldungPage from './pages/AppAnmeldungPage';
import KoppelnPage from './geraet/KoppelnPage';
import KopplungBeendetPage from './geraet/KopplungBeendetPage';
import GeraeteLayout, {
  GeraetAbschnittRahmen,
  GeraetAufnahme,
  GeraetBetreuungRahmen,
  GeraetBetroffenAufnahme,
  GeraetBr,
  GeraetEinsatzRahmen,
  GeraetMeldungen,
  GeraetVerpflegung,
  GeraetVerpflegungAusgabe,
  GeraetStart,
  GeraetMonitor,
  GeraetStelle,
  GeraetUhsRahmen,
  GeraetUhs,
} from './geraet/GeraeteLayout';
import GeraetPatientenPage from './geraet/GeraetPatientenPage';
import GeraetBetroffenePage from './geraet/GeraetBetroffenePage';
import GeraetBetreuungsstellePage from './geraet/GeraetBetreuungsstellePage';
import GeraetAbschnittPage from './geraet/GeraetAbschnittPage';
import GeraetAuftraegePage from './geraet/GeraetAuftraegePage';
import GeraetMeldenPage from './geraet/GeraetMeldenPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import FahrzeugDetailPage from './stammdaten/FahrzeugDetailPage';
import EinheitVorlageDetailPage from './stammdaten/EinheitVorlageDetailPage';
import PersonalDetailPage from './stammdaten/PersonalDetailPage';
import ProfilPage from './pages/ProfilPage';
// Nicht lazy: als eigener Chunk kippt er die Chunk-Aufteilung, und der Haupt-Chunk sprengt das
// Precache-Limit (vite.config.ts, `maximumFileSizeToCacheInBytes`).
import BenachrichtigungenPage from './pages/BenachrichtigungenPage';
import EtbPage from './pages/EtbPage';
import EtbDruckPage from './pages/EtbDruckPage';
import PersonenDruckPage from './pages/PersonenDruckPage';
import PersonDruckPage from './pages/PersonDruckPage';
import TiereDruckPage from './pages/TiereDruckPage';
import SchaedenDruckPage from './pages/SchaedenDruckPage';
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
import EinsatzAbloesung from './pages/einstellungen/EinsatzAbloesung';
import EinsatzGeraete from './pages/einstellungen/EinsatzGeraete';
import EinsatzZugriff from './pages/einstellungen/EinsatzZugriff';
import FahrzeugePage from './pages/FahrzeugePage';
import MaterialPage from './pages/MaterialPage';
import PersonalPage from './pages/PersonalPage';
import EinheitenPage from './pages/EinheitenPage';
import EinheitDetailPage from './pages/EinheitDetailPage';
import EinheitAusVorlagePage from './pages/EinheitAusVorlagePage';
import EinsatzkraftPage from './pages/EinsatzkraftPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
import GefahrenPage from './pages/gefahren/GefahrenPage';
import PersonenPage from './pages/PersonenPage';
import LageDashboardPage from './pages/lage-dashboard/LageDashboardPage';
import UeberblickPage from './pages/fuehrung/UeberblickPage';
import TierePage from './pages/TierePage';
import TiereDetailPage from './pages/TiereDetailPage';
import SchaedenPage from './pages/SchaedenPage';
import DokumentePage from './pages/DokumentePage';
import LagebesprechungPage from './pages/LagebesprechungPage';
import StabPage from './pages/StabPage';
import FunkplanPage from './pages/FunkplanPage';
import KommunikationsplanPage from './pages/KommunikationsplanPage';
import InfotelefonPage from './pages/InfotelefonPage';
import PressePage from './pages/PressePage';
import PressemitteilungDetailPage from './pages/PressemitteilungDetailPage';
import AbloesungPage from './pages/AbloesungPage';
import BetreuungPage from './pages/BetreuungPage';
import BetreuungsstelleDetailPage from './pages/BetreuungsstelleDetailPage';
import EvakuierungPage from './pages/EvakuierungPage';
import VerpflegungPage from './pages/VerpflegungPage';
import AusgabeAnsicht from './verpflegung/AusgabeAnsicht';
import TagAusVorlage from './verpflegung/TagAusVorlage';
import WetterPegelPage from './pages/WetterPegelPage';
import SchaedenDetailPage from './pages/SchaedenDetailPage';
import PersonenDetailPage from './pages/PersonenDetailPage';
import AufnahmePage from './pages/personen/AufnahmePage';
import LageberichtePage from './pages/LageberichtePage';
import LageberichtDetailPage from './pages/LageberichtDetailPage';
import BefehlDetailPage from './pages/BefehlDetailPage';
import AuftragDruckPage from './pages/AuftragDruckPage';
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
import UnfallhilfsstellenDefault from './pages/UnfallhilfsstellenDefault';
import UhsDetailPage from './pages/uhs/UhsDetailPage';
import BereitstellungsraeumePage from './pages/bereitstellungsraum/BereitstellungsraeumePage';
import BereitstellungsraeumeDefault from './pages/bereitstellungsraum/BereitstellungsraeumeDefault';
import BrDetailPage from './pages/bereitstellungsraum/BrDetailPage';
import AdminLayout from './admin/AdminLayout';
import DemoDatenPage from './admin/DemoDatenPage';
import AufbewahrungUebersicht from './aufbewahrung/AufbewahrungUebersicht';
import ZugangsprotokollPage from './zugangsprotokoll/ZugangsprotokollPage';
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
import AltpfadWeiterleitung from './einsatz/AltpfadWeiterleitung';
import ModulStub from './einsatz/ModulStub';
import { modulRegistry } from './einsatz/modulRegistry';
import {
  EINSTELLUNGEN_SEKTIONEN,
  GERAET_START_PFAD,
  BENACHRICHTIGUNGEN_PFAD,
  HILFE_PFAD,
  KOPPELN_PFAD,
  KOPPLUNG_BEENDET_PFAD,
} from './routing/deeplinks';
import LiveStatusBanner from './live/LiveStatusBanner';
import { useOrgLiveStream } from './live/useOrgLiveStream';
import { abgleichFuer, useOfflineSync } from './offline/useOfflineSync';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';

const LagekartePage = lazy(() => import('./pages/LagekartePage'));
const KraefteuebersichtPage = lazy(() => import('./pages/KraefteuebersichtPage'));
// MapLibre gehört nicht ins Bündel der Gerätehülle (wie `LagekartePage`).
const GeraetAbschnittKarte = lazy(() => import('./geraet/GeraetAbschnittKarte'));
// Hilfe (LFH-1096): eigener Chunk mit den Kapiteltexten; der Service Worker hält ihn vor.
const HilfePage = lazy(() => import('./hilfe/HilfePage'));
const NeuigkeitenPage = lazy(() => import('./neuigkeiten/NeuigkeitenPage'));

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
  lagebesprechung: <LagebesprechungPage />,
  stab: <StabPage />,
  // LLH-1180: die Modulroute des Fernmeldewesens zeigt den Funkplan (Reiter Funkplan,
  // Fernmeldeskizze, Sprechgruppen); der Kommunikationsplan ist die Unterroute daneben.
  fernmeldewesen: <FunkplanPage />,
  dokumente: <DokumentePage />,
  abloesung: <AbloesungPage />,
  'wetter-pegel': <WetterPegelPage />,
  personen: <PersonenPage />,
  unfallhilfsstellen: <UnfallhilfsstellenDefault />,
  evakuierung: <EvakuierungPage />,
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
    <Route path="abloesung" element={<EinsatzAbloesung />} />
    <Route path="geraete" element={<EinsatzGeraete />} />
    <Route path="zugriff" element={<EinsatzZugriff />} />
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
  // Org-Strom außerhalb eines Einsatzes (LFH-734); im Einsatz ruht er von selbst.
  useOrgLiveStream(benutzer != null);
  return (
    <>
      <LiveStatusBanner benutzerId={benutzer?.id} klebend />
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
    {/* Hilfe (LFH-1096): ohne Sitzung offen, das Kapitel „Anmelden“ braucht man davor. */}
    {[HILFE_PFAD, `${HILFE_PFAD}/:kapitel`].map((pfad) => (
      <Route
        key={pfad}
        path={pfad}
        element={
          <Suspense fallback={null}>
            <HilfePage />
          </Suspense>
        }
      />
    ))}
    {/* Gerätekopplung (LFH-892): Einlösen und Ende ohne Sitzung, ohne Anmeldung für Personen. */}
    <Route path={KOPPELN_PFAD} element={<KoppelnPage />} />
    <Route path={KOPPLUNG_BEENDET_PFAD} element={<KopplungBeendetPage />} />
    <Route element={<RequireAuth />}>
      {/* Hülle eines gekoppelten Geräts; die Ansichten hängen darunter (LFH-892, design.md D9). */}
      <Route path={GERAET_START_PFAD} element={<GeraeteLayout />}>
        <Route index element={<GeraetStart />} />
        <Route path=":id" element={<GeraetEinsatzRahmen />}>
          <Route index element={<GeraetStart />} />
          <Route path="monitor" element={<GeraetMonitor />} />
          {/* Bereitstellungsraum (LFH-1042): der eigene Raum und die Meldungen. */}
          <Route path="br/:brId" element={<GeraetBr />} />
          <Route path="meldungen" element={<GeraetMeldungen />} />
          <Route path="verpflegung" element={<GeraetVerpflegung />} />
          {/* Ausgabeansicht je Zeitfenster (LLH-1032); die Startseite bleibt die Liste. */}
          <Route path="verpflegung/:zeitfensterId/ausgabe" element={<GeraetVerpflegungAusgabe />} />
          {/* UHS-Ansichten; ein Lagemonitor landet hier auf seiner Startseite. */}
          <Route element={<GeraetUhsRahmen />}>
            <Route path="patienten" element={<GeraetPatientenPage />} />
            <Route path="patienten/:personId" element={<PersonenDetailPage />} />
            <Route path="aufnahme" element={<GeraetAufnahme />} />
            <Route path="uhs/:uhsId" element={<GeraetUhs />} />
            <Route path="stelle" element={<GeraetStelle />} />
          </Route>
          {/* Betreuungsstelle (LFH-1041); jede andere Ansicht landet auf ihrer Startseite. */}
          <Route element={<GeraetBetreuungRahmen />}>
            <Route path="betroffene" element={<GeraetBetroffenePage />} />
            <Route path="betroffene/aufnahme" element={<GeraetBetroffenAufnahme />} />
            <Route path="betroffene/:personId" element={<PersonenDetailPage />} />
            <Route path="betreuung" element={<GeraetBetreuungsstellePage />} />
          </Route>
          {/* Abschnittsansicht (LFH-1043); jede andere Ansicht landet auf ihrer Startseite. */}
          <Route element={<GeraetAbschnittRahmen />}>
            <Route path="abschnitt" element={<GeraetAbschnittPage />} />
            <Route path="auftraege" element={<GeraetAuftraegePage />} />
            <Route path="melden" element={<GeraetMeldenPage />} />
            <Route
              path="karte"
              element={
                <Suspense fallback={<div>Karte wird geladen…</div>}>
                  <GeraetAbschnittKarte />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<GeraetStart />} />
        </Route>
        <Route path="*" element={<GeraetStart />} />
      </Route>
      {/* Bestätigung im Systembrowser für die Mac-App (LFH-818): ohne Rahmen, wie die Anmeldung. */}
      <Route path="/app-anmeldung" element={<AppAnmeldungPage />} />
      <Route element={<BetriebsLayout />}>
        {/* Ebene 1 — globale Shell */}
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          <Route path="/neuigkeiten" element={<NeuigkeitenPage />} />
          {/* Alt-Link bleibt als Redirect in die Admin-Sidebar. */}
          <Route path="/benutzer" element={<Navigate to={adminBenutzerPfad()} replace />} />
          <Route path="/stammdaten" element={<Navigate to="/admin/stammdaten" replace />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path={BENACHRICHTIGUNGEN_PFAD} element={<BenachrichtigungenPage />} />
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
            {/* Zugangsprotokoll (LFH-1097): nur für den System-Admin, die Seite schützt sich selbst. */}
            <Route path="zugangsprotokoll" element={<ZugangsprotokollPage />} />
            {/* Stammdaten-Detailrouten liegen IM `AdminLayout`, damit die Sidebar als Rückweg bleibt,
               und neben der `adminGruppen`-Schleife, weil die Registry keine Detailadressen führt. */}
            <Route path="stammdaten/fahrzeuge/:fahrzeugId" element={<FahrzeugDetailPage />} />
            <Route path="stammdaten/personal/:personalId" element={<PersonalDetailPage />} />
            <Route path="stammdaten/einheiten/:vorlageId" element={<EinheitVorlageDetailPage />} />
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
          {/* Druckansicht eines Auftrags (LLH-1171): das Detail führt hierher, Modul aus `auftraege/`. */}
          <Route path="auftraege/:auftragId/druck" element={<AuftragDruckPage />} />
          <Route path="einheiten/:einheitId" element={<EinheitDetailPage />} />
          {/* Einheit aus Vorlage bilden (LLH-1049): Ziel des Dialogs „Einheit bilden“. */}
          <Route path="einheiten/aus-vorlage/:vorlageId" element={<EinheitAusVorlagePage />} />
          {/* Personenansicht einer Einsatzkraft (LLH-1060); `?personal=` bleibt Zeilenmarke der Liste. */}
          <Route path="personal/:epId" element={<EinsatzkraftPage />} />
          {/* Statisches Segment vor der dynamischen Detail-Route (React Router rankt ohnehin statisch höher). */}
          <Route path="personen/aufnahme" element={<AufnahmePage />} />
          {/* ETB-Druckansicht (LFH-22), Filter aus der Adresse. */}
          <Route path="etb/druck" element={<EtbDruckPage />} />
          {/* Druckansichten der Modul-Listen (LFH-727), Seitenfilter aus der Adresse. */}
          <Route path="personen/druck" element={<PersonenDruckPage />} />
          <Route path="tiere/druck" element={<TiereDruckPage />} />
          <Route path="schaeden/druck" element={<SchaedenDruckPage />} />
          {/* Einsatzbericht (LFH-726): Unterroute der Einsatzdaten, die nie ausgeblendet oder
              gesperrt sind; die Rechte prüft der Bericht je Quelle selbst. */}
          <Route path="einsatzdaten/bericht" element={<EinsatzberichtDruckPage />} />
          {/* Kommunikationsplan S6 (LFH-848): Unterroute des Moduls Fernmeldewesen (LLH-1180). */}
          <Route path="fernmeldewesen/kommunikationsplan" element={<KommunikationsplanPage />} />
          {/* Ausgabeansicht eines Zeitfensters (LLH-1032): Unterroute des Moduls Verpflegung,
              `modulAusPfad` gatet sie über das Segment `verpflegung`. */}
          <Route path="verpflegung/:zeitfensterId/ausgabe" element={<AusgabeAnsicht />} />
          {/* Tag aus Vorlage anlegen (LLH-1058): Unterroute des Moduls, nur am Stab; `modulAusPfad`
              gatet sie über das Segment `verpflegung`. */}
          <Route path="verpflegung/aus-vorlage" element={<TagAusVorlage />} />
          {/* Altadressen der S6-Werkzeuge unter dem Stab leiten dauerhaft um, samt `?ansicht=`
              (LLH-1180, design.md D7). `modulAusPfad` gatet sie nach dem Fernmeldewesen. */}
          <Route path="stab/funkplan" element={<AltpfadWeiterleitung modul="fernmeldewesen" />} />
          <Route
            path="stab/kommunikationsplan"
            element={<AltpfadWeiterleitung modul="fernmeldewesen" unterpfad="kommunikationsplan" />}
          />
          {/* Presse- und Medienarbeit S5 (LFH-554): Unterrouten des Stabs, kein eigenes Modul. */}
          <Route path="stab/presse" element={<PressePage />} />
          <Route
            path="stab/presse/mitteilungen/:mitteilungId"
            element={<PressemitteilungDetailPage />}
          />
          <Route path="stab/infotelefon" element={<InfotelefonPage />} />
          <Route path="personen/:personId" element={<PersonenDetailPage />} />
          <Route path="personen/:personId/druck" element={<PersonDruckPage />} />
          <Route path="tiere/:tierId" element={<TiereDetailPage />} />
          <Route path="betreuung/:stelleId" element={<BetreuungsstelleDetailPage />} />
          <Route path="schaeden/:schadenId" element={<SchaedenDetailPage />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/einsaetze" replace />} />
  </Route>,
);
