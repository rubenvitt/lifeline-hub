import type { ReactNode } from 'react';
import { theme } from 'antd';
import { Navigate, NavLink, Outlet, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import type { GeraetAnzeige } from '../api/types';
import { IconKachelraster, IconPersonPlus, IconPersonen, type Icon } from '../icons';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import LiveStatusBanner from '../live/LiveStatusBanner';
import { abgleichFuer, useOfflineSync } from '../offline/useOfflineSync';
import { EinsatzPfadeProvider, GERAET_PFADE } from '../routing/EinsatzPfade';
import {
  geraetAufnahmePfad,
  geraetPatientenPfad,
  geraetUhsPfad,
  parseRouteId,
} from '../routing/deeplinks';
import { rahmenFarben } from '../theme/tokens';
import AufnahmePage from '../pages/personen/AufnahmePage';
import UhsDetailPage from '../pages/uhs/UhsDetailPage';
import { GeraeteKopf } from './GeraeteKopf';

/** Startseite der Ansicht: Tablet und Laptop beginnen mit der Patientenliste ihrer UHS. */
export function geraetStartPfad(geraet: GeraetAnzeige): string {
  return geraetPatientenPfad(geraet.einsatz_id);
}

/** Leitet auf die Startseite der Ansicht (Index und jede fremde Adresse). */
export function GeraetStart() {
  const { geraet } = useAuth();
  if (!geraet) return <Navigate to="/einsaetze" replace />;
  return <Navigate to={geraetStartPfad(geraet)} replace />;
}

/** Hält `:id` beim eigenen Einsatz; eine fremde Einsatz-ID führt zur Startseite. */
export function GeraetEinsatzRahmen() {
  const { geraet } = useAuth();
  const { id } = useParams();
  if (!geraet || parseRouteId(id) !== geraet.einsatz_id) return <GeraetStart />;
  return <Outlet />;
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

/**
 * Feste Navigation am unteren Rand, in Daumenreichweite (Spec `feldgeraet-bedienung`): Patienten,
 * Aufnahme, Grundriss. Der UHS-Laptop erweitert sie um „UHS“ (LFH-1025).
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
      <NavZiel zu={geraetPatientenPfad(eid)} Icon={IconPersonen}>
        Patienten
      </NavZiel>
      {uhsId != null && (
        <>
          <NavZiel zu={geraetAufnahmePfad(eid, { uhs: uhsId })} Icon={IconPersonPlus}>
            Aufnahme
          </NavZiel>
          <NavZiel zu={geraetUhsPfad(eid, uhsId)} Icon={IconKachelraster}>
            Grundriss
          </NavZiel>
        </>
      )}
    </nav>
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
  return <GeraeteHuelle geraet={geraet} />;
}
