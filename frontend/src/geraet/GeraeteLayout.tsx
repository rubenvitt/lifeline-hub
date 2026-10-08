import type { ReactNode } from 'react';
import { theme } from 'antd';
import { Navigate, NavLink, Outlet, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import type { Funktionsansicht, GeraetAnzeige } from '../api/types';
import {
  IconHausHerz,
  IconKachelraster,
  IconLagerhalle,
  IconPersonPlus,
  IconPersonen,
  IconPosteingang,
  type Icon,
} from '../icons';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import LiveStatusBanner from '../live/LiveStatusBanner';
import { abgleichFuer, useOfflineSync } from '../offline/useOfflineSync';
import { EinsatzPfadeProvider, GERAET_PFADE } from '../routing/EinsatzPfade';
import {
  geraetAufnahmePfad,
  geraetBrPfad,
  geraetMeldungenPfad,
  geraetMonitorPfad,
  geraetPatientenPfad,
  geraetStellePfad,
  geraetUhsPfad,
  parseRouteId,
} from '../routing/deeplinks';
import { rahmenFarben } from '../theme/tokens';
import { SeitenLeer } from '../components/SeitenZustand';
import AufnahmePage from '../pages/personen/AufnahmePage';
import BrDetailPage from '../pages/bereitstellungsraum/BrDetailPage';
import UhsDetailPage from '../pages/uhs/UhsDetailPage';
import GeraetMeldungenPage from './GeraetMeldungenPage';
import GeraetStellePage from './GeraetStellePage';
import LagemonitorPage from './LagemonitorPage';
import { GeraeteKopf } from './GeraeteKopf';
import { geraetDarf } from './geraetSicht';

/** Ob die Ansicht eine der UHS-Ansichten ist, die die Seiten unter {@link GeraetUhsRahmen} nutzen. */
export function istUhsAnsicht(ansicht: Funktionsansicht): boolean {
  return ansicht === 'uhs-tablet' || ansicht === 'uhs-laptop';
}

/**
 * Startseite der Ansicht: Tablet und Laptop beginnen mit der Patientenliste ihrer UHS, der
 * Lagemonitor mit seinem Großbild, der Bereitstellungsraum mit seinem Raum (LFH-1042). Eine
 * Ansicht ohne eigene Seiten (noch nicht freigeschaltet, LFH-1040) hat keine: `null`.
 */
export function geraetStartPfad(geraet: GeraetAnzeige): string | null {
  switch (geraet.ansicht) {
    case 'lagemonitor':
      return geraetMonitorPfad(geraet.einsatz_id);
    case 'uhs-tablet':
    case 'uhs-laptop':
      return geraetPatientenPfad(geraet.einsatz_id);
    case 'bereitstellungsraum':
      return geraet.stelle_id == null ? null : geraetBrPfad(geraet.einsatz_id, geraet.stelle_id);
    case 'betreuungsstelle':
    case 'einsatzabschnitt':
    case 'verpflegung':
      return null;
  }
}

/** Leitet auf die Startseite der Ansicht (Index und jede fremde Adresse). */
export function GeraetStart() {
  const { geraet } = useAuth();
  if (!geraet) return <Navigate to="/einsaetze" replace />;
  const pfad = geraetStartPfad(geraet);
  // Ohne Startseite kein Umleiten: jede Seite führte wieder hierher.
  if (!pfad) return <SeitenLeer titel="Ansicht nicht verfügbar" />;
  return <Navigate to={pfad} replace />;
}

/** Hält `:id` beim eigenen Einsatz; eine fremde Einsatz-ID führt zur Startseite. */
export function GeraetEinsatzRahmen() {
  const { geraet } = useAuth();
  const { id } = useParams();
  if (!geraet || parseRouteId(id) !== geraet.einsatz_id) return <GeraetStart />;
  return <Outlet />;
}

/** Die Seiten der UHS-Ansichten; jede andere Ansicht landet auf ihrer Startseite. */
export function GeraetUhsRahmen() {
  const { geraet } = useAuth();
  if (!geraet || !istUhsAnsicht(geraet.ansicht)) return <GeraetStart />;
  return <Outlet />;
}

/** Großbild nur für den Lagemonitor. */
export function GeraetMonitor() {
  const { geraet } = useAuth();
  if (!geraet || geraet.ansicht !== 'lagemonitor') return <GeraetStart />;
  return <LagemonitorPage />;
}

/** Aufnahme immer in die eigene UHS: der Auftrag `?uhs` steht fest, ein anderer wird ersetzt. */
export function GeraetAufnahme() {
  const { geraet } = useAuth();
  const [suche] = useSearchParams();
  if (!geraet || geraet.uhs_id == null) return <GeraetStart />;
  if (parseRouteId(suche.get('uhs') ?? undefined) !== geraet.uhs_id) {
    return <Navigate to={geraetAufnahmePfad(geraet.einsatz_id, { uhs: geraet.uhs_id })} replace />;
  }
  return <AufnahmePage />;
}

/** Grundriss nur der eigenen UHS; jede andere Kennung führt zur Startseite. */
export function GeraetUhs() {
  const { geraet } = useAuth();
  const { uhsId } = useParams();
  if (!geraet || geraet.uhs_id == null || parseRouteId(uhsId) !== geraet.uhs_id) {
    return <GeraetStart />;
  }
  return <UhsDetailPage />;
}

/** Der eigene Bereitstellungsraum (LFH-1042); jede andere Kennung führt zur Startseite. */
export function GeraetBr() {
  const { geraet } = useAuth();
  const { brId } = useParams();
  if (
    !geraet ||
    geraet.ansicht !== 'bereitstellungsraum' ||
    geraet.stelle_id == null ||
    parseRouteId(brId) !== geraet.stelle_id
  ) {
    return <GeraetStart />;
  }
  return <BrDetailPage />;
}

/** Meldungen an die Einsatzleitung für Ansichten ohne eigenen Stellenbereich (Bereitstellungsraum). */
export function GeraetMeldungen() {
  const { geraet } = useAuth();
  if (!geraet || geraet.ansicht !== 'bereitstellungsraum') return <GeraetStart />;
  return <GeraetMeldungenPage />;
}

/** Bereich „UHS“ nur für die Ansicht, die Material und Dateien ihrer UHS führt (UHS-Laptop). */
export function GeraetStelle() {
  const { geraet } = useAuth();
  if (!geraet || geraet.uhs_id == null || !geraetDarf(geraet, 'uhs-material')) {
    return <GeraetStart />;
  }
  return <GeraetStellePage />;
}

function NavZiel({ zu, Icon, children }: { zu: string; Icon: Icon; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <NavLink
      to={zu}
      style={({ isActive }) => ({
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        // Daumenziel: die Steuerhöhe der Stufe, nie unter 48 px (LFH-384).
        minHeight: Math.max(56, token.controlHeight),
        paddingBlock: token.paddingXS,
        textDecoration: 'none',
        fontSize: 13,
        background: isActive ? rahmenFarben.aktiv : 'transparent',
        boxShadow: isActive ? `inset 0 3px 0 ${rahmenFarben.marke}` : 'none',
        color: isActive ? rahmenFarben.text : rahmenFarben.gedaempft,
      })}
    >
      <Icon size={22} />
      {children}
    </NavLink>
  );
}

/** Ziele des Bereitstellungsraums (LFH-1042): der eigene Raum und die Meldungen. */
function BrNavigationsziele({ geraet }: { geraet: GeraetAnzeige }) {
  const eid = geraet.einsatz_id;
  return (
    <>
      {geraet.stelle_id != null && (
        <NavZiel zu={geraetBrPfad(eid, geraet.stelle_id)} Icon={IconLagerhalle}>
          Raum
        </NavZiel>
      )}
      <NavZiel zu={geraetMeldungenPfad(eid)} Icon={IconPosteingang}>
        Meldungen
      </NavZiel>
    </>
  );
}

/**
 * Feste Navigation am unteren Rand, in Daumenreichweite (Spec `feldgeraet-bedienung`): Patienten,
 * Aufnahme, Grundriss; der UHS-Laptop zusätzlich „UHS“ mit Plätzen, Material und Meldungen. Der
 * Bereitstellungsraum führt Raum und Meldungen.
 */
function GeraeteNavigation({ geraet }: { geraet: GeraetAnzeige }) {
  const eid = geraet.einsatz_id;
  const uhsId = geraet.uhs_id;
  return (
    <nav
      aria-label="Gerätenavigation"
      data-lfh="geraet-navigation"
      style={{
        display: 'flex',
        background: rahmenFarben.grund,
        borderTop: `1px solid ${rahmenFarben.linie}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {geraet.ansicht === 'bereitstellungsraum' ? (
        <BrNavigationsziele geraet={geraet} />
      ) : (
        <NavZiel zu={geraetPatientenPfad(eid)} Icon={IconPersonen}>
          Patienten
        </NavZiel>
      )}
      {uhsId != null && (
        <>
          <NavZiel zu={geraetAufnahmePfad(eid, { uhs: uhsId })} Icon={IconPersonPlus}>
            Aufnahme
          </NavZiel>
          <NavZiel zu={geraetUhsPfad(eid, uhsId)} Icon={IconKachelraster}>
            Grundriss
          </NavZiel>
          {geraetDarf(geraet, 'uhs-material') && (
            <NavZiel zu={geraetStellePfad(eid)} Icon={IconHausHerz}>
              UHS
            </NavZiel>
          )}
        </>
      )}
    </nav>
  );
}

/**
 * Hülle des Lagemonitors: bildschirmfüllend, ohne Kopfzeile und Navigation; die Statusleiste
 * trägt die Seite selbst. Der Einsatzstrom hält die Zahlen aktuell und beendet die Anzeige beim
 * Widerruf. Keine Schreib-Warteschlange: der Monitor schreibt nichts.
 */
function MonitorHuelle({ geraet }: { geraet: GeraetAnzeige }) {
  useEinsatzLiveStream(geraet.einsatz_id);
  return (
    <EinsatzPfadeProvider pfade={GERAET_PFADE}>
      <Outlet />
    </EinsatzPfadeProvider>
  );
}

function GeraeteHuelle({ geraet }: { geraet: GeraetAnzeige }) {
  const { benutzer, konflikt } = useAuth();
  // Der Einsatzstrom hält die Daten live und trägt das Ende der Kopplung: schließt der Server ihn
  // nach einem Widerruf, prüft der Client die Sitzung, und der 401 führt auf „Kopplung beendet“
  // (design.md D7). Kein Org-Strom: `/api/live` gehört nicht zur Ansicht.
  useEinsatzLiveStream(geraet.einsatz_id);
  // Die Warteschlange bleibt an: eine Aufnahme ohne Netz geht nicht verloren (design.md D8).
  useOfflineSync(abgleichFuer(benutzer, konflikt !== null));
  return (
    <EinsatzPfadeProvider pfade={GERAET_PFADE}>
      <div
        className="geraet-huelle"
        style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}
      >
        <GeraeteKopf geraet={geraet} />
        <LiveStatusBanner benutzerId={benutzer?.id} />
        <main
          style={{
            flex: '1 1 0',
            minHeight: 0,
            overflow: 'auto',
            padding: 'var(--lfh-seiten-polsterung)',
          }}
        >
          <Outlet />
        </main>
        <GeraeteNavigation geraet={geraet} />
      </div>
    </EinsatzPfadeProvider>
  );
}

/**
 * Hülle eines gekoppelten Geräts (LFH-892, design.md D9): keine Modulleiste, keine Sprungpalette,
 * kein Benutzermenü, sondern Kopfzeile mit Stelle, Gerät, Verbindung und Kopplungsende, das
 * Gerätemenü und eine feste Navigation unten. Eine Person landet hier nicht; `RequireAuth` hält das
 * Gerät umgekehrt auf diesen Pfaden.
 */
export default function GeraeteLayout() {
  const { geraet } = useAuth();
  if (!geraet) return <Navigate to="/einsaetze" replace />;
  if (geraet.ansicht === 'lagemonitor') return <MonitorHuelle geraet={geraet} />;
  return <GeraeteHuelle geraet={geraet} />;
}
