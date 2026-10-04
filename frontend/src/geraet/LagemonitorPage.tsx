import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeLagemonitor } from '../api/lagemonitor';
import { einsatzKeys } from '../api/queryKeys';
import type { GeraetAnzeige, LagemonitorAnzeige } from '../api/types';
import { useRollen } from '../components/instrument';
import { abonniereLiveStatus, leseLiveStatus } from '../live/liveStatusStore';
import { useHelligkeit, useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';
import { HELLIGKEIT_OPTIONEN } from '../theme/darstellungOptionen';
import { schrift } from '../theme/tokens';
import LagemonitorKarte from './LagemonitorKarte';

/** Ab diesem Alter gilt der Datenstand als veraltet (Spec `lagemonitor`, „Veralteter Stand“). */
export const VERALTET_AB_MS = 2 * 60_000;
/** So lange muss die Statusleiste gedrückt werden, bis das Gerätemenü aufgeht. */
export const LANG_DRUECKEN_MS = 3_000;
/** Ohne Eingabe schließt das Gerätemenü nach dieser Zeit. */
export const MENUE_ZU_MS = 30_000;
/**
 * Takt, in dem der Monitor das Lagebild zusätzlich zum Live-Kanal holt: Personen-Ereignisse
 * erreichen ihn nicht (sie tragen Personenkennungen), die Kopfzahlen ändern sich trotzdem.
 */
export const ABRUF_TAKT_MS = 30_000;

/** Kennzahlen mindestens 72 px, jeder Text mindestens 28 px (Großbild-Regel, `geraet/AGENTS.md`). */
export const GROSS = { kennzahl: 96, kennzahlKlein: 72, text: 28, titel: 32 } as const;

export function istVeraltet(standMs: number, jetztMs: number): boolean {
  return standMs > 0 && jetztMs - standMs > VERALTET_AB_MS;
}

/** „vor 3 min“, unter einer Minute „gerade eben“. */
export function alterText(standMs: number, jetztMs: number): string {
  const minuten = Math.floor((jetztMs - standMs) / 60_000);
  return minuten < 1 ? 'gerade eben' : `vor ${minuten} min`;
}

type WachZustand = 'aus' | 'an' | 'nicht-unterstuetzt';

/**
 * Bildschirm-Wachhalten (Spec `lagemonitor`, „Bildschirm bleibt an“): nach „Anzeige starten“
 * angefordert und bei jeder Rückkehr in den Vordergrund neu, denn der Browser gibt die Sperre
 * beim Verstecken des Tabs frei. Ohne `navigator.wakeLock` bleibt der Zustand
 * `nicht-unterstuetzt`, und die Seite zeigt den Hinweis zum Bildschirmschoner.
 */
export function useBildschirmWach(gestartet: boolean): WachZustand {
  const unterstuetzt = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [an, setAn] = useState(false);
  useEffect(() => {
    if (!gestartet || !unterstuetzt) return;
    let sperre: WakeLockSentinel | null = null;
    let aktiv = true;
    const anfordern = async () => {
      try {
        sperre = await navigator.wakeLock.request('screen');
        if (!aktiv) {
          void sperre.release();
          return;
        }
        setAn(true);
        sperre.addEventListener('release', () => setAn(false));
      } catch {
        setAn(false);
      }
    };
    const sichtbar = () => {
      if (document.visibilityState === 'visible') void anfordern();
    };
    void anfordern();
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      aktiv = false;
      document.removeEventListener('visibilitychange', sichtbar);
      void sperre?.release();
    };
  }, [gestartet, unterstuetzt]);
  if (!unterstuetzt) return 'nicht-unterstuetzt';
  return an ? 'an' : 'aus';
}

function useJetzt(taktMs: number): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setJetzt(Date.now()), taktMs);
    return () => window.clearInterval(id);
  }, [taktMs]);
  return jetzt;
}

function Kachel({
  titel,
  children,
  style,
}: {
  titel: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { rollen } = useRollen();
  return (
    <section
      aria-label={titel}
      style={{
        background: rollen.flaeche,
        border: `1px solid ${rollen.linie}`,
        borderRadius: 8,
        padding: '16px 24px',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...style,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: GROSS.titel,
          lineHeight: 1.2,
          fontWeight: 600,
          color: rollen.gedaempft,
        }}
      >
        {titel}
      </h2>
      {children}
    </section>
  );
}

function Zahl({
  wert,
  bezeichnung,
  groesse = GROSS.kennzahlKlein,
  farbe,
}: {
  wert: number | string;
  bezeichnung: string;
  groesse?: number;
  farbe?: string;
}) {
  const { rollen } = useRollen();
  return (
    <div data-lfh="monitor-zahl" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span
        style={{
          fontFamily: schrift.zahl,
          fontVariantNumeric: 'tabular-nums',
          fontSize: groesse,
          lineHeight: 1,
          fontWeight: 600,
          color: farbe ?? rollen.text,
        }}
      >
        {wert}
      </span>
      <span
        style={{
          fontSize: GROSS.text,
          color: rollen.gedaempft,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {bezeichnung}
      </span>
    </div>
  );
}

/** So viele UHS passen ohne Bildlauf in die Kachel; der Rest steht als „+n weitere“. */
const UHS_SICHTBAR = 6;

function Kacheln({ lage }: { lage: LagemonitorAnzeige }) {
  const { rollen } = useRollen();
  const b = lage.betroffene;
  const k = lage.kraefte;
  const s = k.staerke;
  // Die vollsten zuerst: passt nicht jede UHS in die Kachel, fehlen die leeren.
  const uhsSichtbar = [...lage.uhs]
    .sort((x, y) => y.belegt - x.belegt || x.bezeichnung.localeCompare(y.bezeichnung, 'de'))
    .slice(0, UHS_SICHTBAR);
  const weitere = lage.uhs.length - uhsSichtbar.length;
  return (
    <>
      <Kachel titel="Betroffene">
        <div style={{ display: 'flex', gap: 48, alignItems: 'flex-end' }}>
          <Zahl wert={b.gesamt} bezeichnung="gesamt" groesse={GROSS.kennzahl} />
          <Zahl wert={b.patienten} bezeichnung="Patienten" groesse={GROSS.kennzahl} />
          <Zahl
            wert={b.vermisst}
            bezeichnung="vermisst"
            groesse={GROSS.kennzahl}
            farbe={b.vermisst > 0 ? rollen.achtungText : undefined}
          />
        </div>
        <div style={{ display: 'flex', gap: 32 }}>
          <Zahl wert={b.sk1} bezeichnung="SK I" farbe={b.sk1 > 0 ? rollen.alarmText : undefined} />
          <Zahl wert={b.sk2} bezeichnung="SK II" />
          <Zahl wert={b.sk3} bezeichnung="SK III" />
          <Zahl wert={b.sk4} bezeichnung="SK IV" />
          <Zahl wert={b.ohne} bezeichnung="ungesichtet" />
        </div>
      </Kachel>
      <Kachel titel="Kräfte">
        <div style={{ display: 'flex', gap: 48, alignItems: 'flex-end' }}>
          <Zahl wert={k.personal} bezeichnung="Personal" />
          <Zahl wert={k.einheiten} bezeichnung="Einheiten" />
          <Zahl
            wert={`${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}`}
            bezeichnung="Stärke F/UF/M"
          />
        </div>
      </Kachel>
      <Kachel titel="Belegung der Unfallhilfsstellen" style={{ flex: '1 1 0' }}>
        {lage.uhs.length === 0 ? (
          <span style={{ fontSize: GROSS.text, color: rollen.gedaempft }}>
            Keine Unfallhilfsstelle eingerichtet
          </span>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '8px 32px',
            }}
          >
            {uhsSichtbar.map((u) => (
              <div key={u.id} data-lfh="monitor-uhs" style={{ minWidth: 0 }}>
                <Zahl
                  wert={u.plaetze > 0 ? `${u.belegt}/${u.plaetze}` : u.belegt}
                  bezeichnung={u.bezeichnung}
                />
              </div>
            ))}
          </div>
        )}
        {weitere > 0 && (
          <span style={{ fontSize: GROSS.text, color: rollen.gedaempft }}>+{weitere} weitere</span>
        )}
      </Kachel>
    </>
  );
}

function Geraetemenue({ onSchliessen }: { onSchliessen: () => void }) {
  const { rollen } = useRollen();
  const { modus, setModus } = useThemeMode();
  const { helligkeit, setHelligkeit } = useHelligkeit();
  const zuRef = useRef<number | undefined>(undefined);
  const nachspannen = useCallback(() => {
    window.clearTimeout(zuRef.current);
    zuRef.current = window.setTimeout(onSchliessen, MENUE_ZU_MS);
  }, [onSchliessen]);
  useEffect(() => {
    nachspannen();
    return () => window.clearTimeout(zuRef.current);
  }, [nachspannen]);

  const knopf = (aktiv: boolean): CSSProperties => ({
    fontSize: GROSS.text,
    minHeight: 72,
    padding: '8px 24px',
    borderRadius: 8,
    border: `2px solid ${aktiv ? rollen.marke : rollen.linieStark}`,
    background: aktiv ? rollen.bedienHover : rollen.flaeche,
    color: rollen.text,
    cursor: 'pointer',
  });
  const modi: { wert: ThemeModus; titel: string }[] = [
    { wert: 'light', titel: 'Tag' },
    { wert: 'dark', titel: 'Nacht' },
    { wert: 'system', titel: 'Automatik' },
  ];
  return (
    <div
      role="dialog"
      aria-label="Gerätemenü"
      onPointerDown={nachspannen}
      onKeyDown={nachspannen}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: rollen.grund,
          border: `1px solid ${rollen.linieStark}`,
          borderRadius: 12,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          color: rollen.text,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={knopf(false)}
            onClick={() => void document.documentElement.requestFullscreen?.()}
          >
            Vollbild
          </button>
          <button type="button" style={knopf(false)} onClick={() => window.location.reload()}>
            Neu laden
          </button>
        </div>
        <div role="group" aria-label="Darstellung" style={{ display: 'flex', gap: 16 }}>
          {modi.map((m) => (
            <button
              key={m.wert}
              type="button"
              aria-pressed={modus === m.wert}
              style={knopf(modus === m.wert)}
              onClick={() => setModus(m.wert)}
            >
              {m.titel}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Helligkeit" style={{ display: 'flex', gap: 16 }}>
          {HELLIGKEIT_OPTIONEN.map((h) => (
            <button
              key={h.wert}
              type="button"
              aria-pressed={helligkeit === h.wert}
              style={knopf(helligkeit === h.wert)}
              onClick={() => setHelligkeit(h.wert)}
            >
              {h.titel}
            </button>
          ))}
        </div>
        <button type="button" style={knopf(false)} onClick={onSchliessen}>
          Schließen
        </button>
      </div>
    </div>
  );
}

const VERBINDUNG_TEXT = {
  idle: 'verbinde …',
  connecting: 'verbinde …',
  open: 'live',
  lost: 'getrennt',
} as const;

function Statusleiste({
  geraet,
  einsatzName,
  standMs,
  jetzt,
  onMenue,
}: {
  geraet: GeraetAnzeige;
  einsatzName: string | undefined;
  standMs: number;
  jetzt: number;
  onMenue: () => void;
}) {
  const { rollen } = useRollen();
  const verbindung = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus);
  const druck = useRef<number | undefined>(undefined);
  const loslassen = () => window.clearTimeout(druck.current);
  const druecken = () => {
    loslassen();
    druck.current = window.setTimeout(onMenue, LANG_DRUECKEN_MS);
  };
  useEffect(() => loslassen, []);
  const veraltet = istVeraltet(standMs, jetzt);
  return (
    <footer
      data-lfh="monitor-statusleiste"
      onPointerDown={druecken}
      onPointerUp={loslassen}
      onPointerLeave={loslassen}
      onPointerCancel={loslassen}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 48,
        padding: '0 24px',
        minHeight: 72,
        fontSize: GROSS.text,
        background: rollen.kopf,
        borderTop: `1px solid ${rollen.linie}`,
        color: rollen.text,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <strong
        style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {einsatzName ?? 'Lagemonitor'}
      </strong>
      <span>{geraet.bezeichnung}</span>
      <span data-lfh="monitor-verbindung" data-zustand={verbindung}>
        {VERBINDUNG_TEXT[verbindung]}
      </span>
      <span
        data-lfh="monitor-datenstand"
        data-veraltet={veraltet ? 'ja' : 'nein'}
        style={{
          fontWeight: veraltet ? 700 : 400,
          color: veraltet ? rollen.alarmText : rollen.text,
          background: veraltet ? rollen.alarmFuellung : 'transparent',
          padding: '4px 12px',
          borderRadius: 6,
        }}
      >
        {standMs > 0
          ? `${veraltet ? 'Veraltet · ' : ''}Stand ${dayjs(standMs).format('HH:mm')} · ${alterText(standMs, jetzt)}`
          : 'Kein Stand'}
      </span>
      <span style={{ fontFamily: schrift.zahl }}>{dayjs(jetzt).format('HH:mm')}</span>
    </footer>
  );
}

/**
 * Lagemonitor (LFH-892, Subtask LFH-1026; Spec `lagemonitor`): feste Kachelung ohne Bildlauf bei
 * 1920 × 1080, Karte und Kacheln ohne Bedienung, nur verdichtete Zahlen. Die Statusleiste trägt
 * Einsatz, Gerät, Verbindung und den Datenstand mit Alter; nach 3 s Drücken öffnet sie das
 * Gerätemenü. „Anzeige starten“ fordert Vollbild und Wachhalten an.
 */
export default function LagemonitorPage() {
  const { geraet } = useAuth();
  const { rollen } = useRollen();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const [gestartet, setGestartet] = useState(false);
  const [menueOffen, setMenueOffen] = useState(false);
  const wach = useBildschirmWach(gestartet);
  const jetzt = useJetzt(10_000);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const lageQuery = useQuery({
    queryKey: einsatzKeys.lagemonitor(einsatzId),
    queryFn: () => ladeLagemonitor(einsatzId),
    enabled: geraet != null,
    refetchInterval: ABRUF_TAKT_MS,
    refetchIntervalInBackground: true,
  });
  const einsatz = einsatzQuery.data;
  const lage = lageQuery.data;
  const schliesseMenue = useCallback(() => setMenueOffen(false), []);

  if (!geraet) return null;
  const einsatzort =
    einsatz?.einsatzort_lat != null && einsatz?.einsatzort_lon != null
      ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
      : null;

  return (
    <div
      className="lagemonitor"
      style={{
        height: '100dvh',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto auto',
        background: rollen.grund,
        color: rollen.text,
      }}
    >
      <main
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
          gap: 16,
          padding: 16,
          minHeight: 0,
          // Keine Bedienung der Kacheln: Tippen und Ziehen bleiben wirkungslos.
          pointerEvents: 'none',
        }}
      >
        <Kachel titel="Lagekarte">
          <div style={{ flex: '1 1 0', minHeight: 0 }}>
            <LagemonitorKarte einsatzort={einsatzort} uhs={lage?.uhs ?? []} />
          </div>
        </Kachel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          {lage ? (
            <Kacheln lage={lage} />
          ) : (
            <Kachel titel="Lagebild">
              <span style={{ fontSize: GROSS.text }}>
                {lageQuery.isError ? 'Lagebild nicht erreichbar' : 'Lagebild wird geladen …'}
              </span>
            </Kachel>
          )}
        </div>
      </main>
      {wach === 'nicht-unterstuetzt' && (
        <div
          role="note"
          data-lfh="monitor-wach-hinweis"
          style={{
            fontSize: GROSS.text,
            padding: '8px 24px',
            background: rollen.achtungFuellung,
            color: rollen.text,
          }}
        >
          Dieser Browser kann den Bildschirm nicht wach halten: bitte den Bildschirmschoner am Gerät
          abschalten.
        </div>
      )}
      <Statusleiste
        geraet={geraet}
        einsatzName={einsatz?.bezeichnung}
        standMs={lageQuery.dataUpdatedAt}
        jetzt={jetzt}
        onMenue={() => setMenueOffen(true)}
      />
      {!gestartet && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0,0,0,0.5)',
            zIndex: 5,
          }}
        >
          <button
            type="button"
            onClick={() => {
              void document.documentElement.requestFullscreen?.().catch(() => undefined);
              setGestartet(true);
            }}
            style={{
              fontSize: GROSS.titel,
              minHeight: 96,
              padding: '16px 48px',
              borderRadius: 12,
              border: 'none',
              background: rollen.marke,
              color: rollen.grund,
              cursor: 'pointer',
            }}
          >
            Anzeige starten
          </button>
        </div>
      )}
      {menueOffen && <Geraetemenue onSchliessen={schliesseMenue} />}
    </div>
  );
}
