import { Button } from 'antd';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAlarmZone } from '../../alarm/alarmZoneSpeicher';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
import type { Einsatzart } from '../../api/types';
import { IconPfeileEinwaerts, IconVollbildEcken, IconWarndreieck } from '../../icons';
import { schrift } from '../../theme/tokens';
import { UebungsMarke } from '../instrument/Uebung';
import { useRollen } from '../instrument/rollenwerte';
import { statusFlaeche } from '../instrument/statusFlaeche';
import { GROSS_BEZUG, grossMass } from './grossMass';
import { useBildschirmWach } from './useBildschirmWach';

/**
 * Ebene der Fläche ohne Vollbild: über jedem klebenden Rahmen (`RAHMEN_EBENE` 100, Alarmzone
 * eingeschlossen), unter antds Popups (ab 1000). Im Großbild öffnet sich kein Dialog.
 */
export const GROSSBILD_EBENE = 900;

interface GrossbildFlaecheProps {
  /** Name der Seite (Menüname); zugleich der Name des Dialogs. */
  titel: string;
  /** Uhrzeit, Datenstand: rechts neben dem Titel in Mono. */
  meta?: ReactNode;
  /** Für die Übungsmarke (ADR-0053). */
  einsatz?: { einsatzart?: Einsatzart | null } | null;
  onVerlassen: () => void;
  children: ReactNode;
}

function countText(n: number, eins: string, viele: string): string {
  return `${n} ${n === 1 ? eins : viele} offen`;
}

/**
 * Hülle des Großbilds (LLH-1747, Spec `grossbild-ansicht`; design.md D2 in
 * `openspec/changes/ckl1wbvz-grossbild-lage/`).
 *
 * Per Portal neben der App, fest über das ganze Fenster, ohne Bildlauf. Beim Öffnen fordert sie
 * Vollbild für sich selbst an (nicht für das Dokument): dann zeigt der Browser nur sie, Rahmen und
 * Alarmzone sind weg. Lehnt er ab oder fehlt die API, füllt sie das Fenster, und „Vollbild“ holt den
 * Versuch mit einer Geste nach.
 *
 * Ende: „Großbild verlassen“, Esc und jedes Verlassen des Vollbilds (Esc im Vollbild sieht die
 * Seite nicht, nur das `fullscreenchange`). Solange sie steht, ist die App dahinter `inert` und das
 * Dokument rollt nicht; der Fokus geht beim Öffnen auf „Großbild verlassen“ und danach an das
 * Element zurück, das ihn vorher hatte.
 *
 * Die Alarmzone verdeckt das Vollbild. Darum nennt die Kopfzeile ihre Einträge als Zahl, ohne Titel:
 * die Fläche steht vor allen im Raum (D6). Ebenso verdeckt sie die Verbindungsanzeige der
 * Kopfleiste: ist der Live-Kanal getrennt, steht „Verbindung getrennt“ in Achtungsrolle, damit
 * niemand alte Zahlen für aktuell hält (Review vor dem PR).
 */
export default function GrossbildFlaeche({
  titel,
  meta,
  einsatz,
  onVerlassen,
  children,
}: GrossbildFlaecheProps) {
  const { rollen } = useRollen();
  const flaeche = useRef<HTMLDivElement>(null);
  const verlassenKnopf = useRef<HTMLButtonElement>(null);
  const verlassen = useRef(onVerlassen);
  verlassen.current = onVerlassen;
  const canVollbild =
    typeof HTMLElement !== 'undefined' && 'requestFullscreen' in HTMLElement.prototype;
  const [isVollbild, setIsVollbild] = useState(false);
  useBildschirmWach(true);
  const { eintraege } = useAlarmZone();
  const alarme = eintraege.filter((e) => e.stufe === 'alarm').length;
  const hinweise = eintraege.length - alarme;
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);

  const requestVollbild = useCallback(() => {
    const el = flaeche.current;
    if (!el?.requestFullscreen) return;
    el.requestFullscreen().catch(() => setIsVollbild(false));
  }, []);

  // App dahinter sperren, Dokument nicht rollen lassen, Fokus hin und zurück.
  useEffect(() => {
    const vorher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const html = document.documentElement;
    const overflowVorher = html.style.overflow;
    html.style.overflow = 'hidden';
    const app = document.getElementById('root');
    const inertVorher = app?.inert ?? false;
    if (app) app.inert = true;
    verlassenKnopf.current?.focus();
    return () => {
      html.style.overflow = overflowVorher;
      if (app) app.inert = inertVorher;
      vorher?.focus();
    };
  }, []);

  // Vollbild beim Öffnen; sein Ende beendet das Großbild.
  useEffect(() => {
    const el = flaeche.current;
    let wasVollbild = false;
    const onChange = () => {
      const isJetzt = el != null && document.fullscreenElement === el;
      setIsVollbild(isJetzt);
      if (wasVollbild && !isJetzt) verlassen.current();
      wasVollbild = isJetzt;
    };
    document.addEventListener('fullscreenchange', onChange);
    requestVollbild();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (el != null && document.fullscreenElement === el) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [requestVollbild]);

  // Tasten: Esc beendet (ohne Vollbild; im Vollbild nimmt der Browser die Taste selbst und meldet
  // nur `fullscreenchange`). Jede andere Taste erreicht die App nicht: `inert` sperrt nur Klick und
  // Fokus unter `#root`, die Kürzel der App (Sprungpalette Strg+K) hören aber am `window` und
  // öffneten Dialoge über dem Großbild (Review vor dem PR). Der Hörer sitzt darum in der
  // Capture-Phase am `window`, vor jedem anderen, und stoppt die Weitergabe; Standardaktionen
  // (Tab, Enter und Leertaste an den eigenen Knöpfen) bleiben unberührt.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') verlassen.current();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  const alarmFarbe = statusFlaeche(rollen, 'alarm');
  const hinweisFarbe = statusFlaeche(rollen, 'bedien');
  const achtungFarbe = statusFlaeche(rollen, 'achtung');
  const kopfSchrift = { fontSize: grossMass(GROSS_BEZUG.text), lineHeight: 1.2 };
  const knopfStil = {
    ...kopfSchrift,
    height: 'auto',
    minHeight: grossMass(56),
    paddingInline: grossMass(20),
  };

  return createPortal(
    <div
      ref={flaeche}
      role="dialog"
      aria-modal="true"
      aria-label={titel}
      data-lfh="grossbild"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: GROSSBILD_EBENE,
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: grossMass(GROSS_BEZUG.luft),
        padding: `${grossMass(GROSS_BEZUG.luft)} ${grossMass(GROSS_BEZUG.rand)}`,
        background: rollen.grund,
        color: rollen.text,
        fontFamily: schrift.text,
      }}
    >
      <div
        data-lfh="grossbild-kopf"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: grossMass(24),
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: grossMass(GROSS_BEZUG.titel),
            lineHeight: 1.2,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {titel}
        </h1>
        {meta != null && (
          <span
            data-lfh="grossbild-meta"
            style={{
              ...kopfSchrift,
              fontFamily: schrift.zahl,
              fontVariantNumeric: 'tabular-nums',
              color: rollen.gedaempft,
            }}
          >
            {meta}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span role="status" style={{ display: 'contents' }}>
          {alarme > 0 && (
            <span
              data-lfh="grossbild-alarme"
              style={{
                ...kopfSchrift,
                display: 'inline-flex',
                alignItems: 'center',
                gap: grossMass(12),
                minHeight: grossMass(56),
                paddingInline: grossMass(20),
                background: alarmFarbe.grund,
                boxShadow: `inset ${grossMass(6)} 0 0 0 ${alarmFarbe.kante}`,
                color: alarmFarbe.text,
                fontWeight: 700,
              }}
            >
              <IconWarndreieck />
              {countText(alarme, 'Alarm', 'Alarme')}
            </span>
          )}
          {hinweise > 0 && (
            <span
              data-lfh="grossbild-hinweise"
              style={{
                ...kopfSchrift,
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: grossMass(56),
                paddingInline: grossMass(20),
                background: hinweisFarbe.grund,
                boxShadow: `inset ${grossMass(3)} 0 0 0 ${hinweisFarbe.kante}`,
                color: hinweisFarbe.text,
                fontWeight: 600,
              }}
            >
              {countText(hinweise, 'Hinweis', 'Hinweise')}
            </span>
          )}
        </span>
        {liveStatus === 'lost' && (
          <span
            data-lfh="grossbild-verbindung"
            style={{
              ...kopfSchrift,
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: grossMass(56),
              paddingInline: grossMass(20),
              background: achtungFarbe.grund,
              boxShadow: `inset ${grossMass(3)} 0 0 0 ${achtungFarbe.kante}`,
              color: achtungFarbe.text,
              fontWeight: 700,
            }}
          >
            Verbindung getrennt
          </span>
        )}
        <UebungsMarke einsatz={einsatz} groesse="grossbild" />
        {canVollbild && !isVollbild && (
          <Button icon={<IconVollbildEcken />} onClick={requestVollbild} style={knopfStil}>
            Vollbild
          </Button>
        )}
        <Button
          ref={verlassenKnopf}
          icon={<IconPfeileEinwaerts />}
          onClick={() => verlassen.current()}
          style={knopfStil}
        >
          Großbild verlassen
        </Button>
      </div>
      <div
        data-lfh="grossbild-inhalt"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: grossMass(GROSS_BEZUG.luft),
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
