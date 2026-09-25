import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { App, Button, Input, Slider, Space, theme, Tooltip } from 'antd';
import {
  CameraOutlined,
  DownOutlined,
  HistoryOutlined,
  PauseOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { formatZeitKurz } from '../../anzeige/format';
import { useLageSnapshots } from './useLageSnapshots';
import { bandStil } from './KartenFuss';
import { useViewport } from '../../components/useViewport';

/** Feste Anzeigedauer je Stand im Replay (D/LFH-322). */
export const ANZEIGE_MS = 2500;

// Ein-/Ausklappen ist eine Per-User-Anzeigevorliebe, KEINE Ansichts-Konfiguration: die Leiste
// liegt über der Karte und ist ein Werkzeug auf Abruf, kein Dauerelement. Deshalb localStorage
// (Muster wie alarmTon/ThemeModeProvider) und bewusst NICHT der Konfig-Bag von `useKartenAnsicht`
// — dort würde sie geteilt und jede Klapp-Aktion machte die Ansicht schmutzig.
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeitachse-eingeklappt';

/** Gemerkte Wahl: `true`/`false`, oder `null`, wenn nie gewählt wurde. */
function gespeichertEingeklappt(): boolean | null {
  try {
    const wert = localStorage.getItem(SPEICHER_SCHLUESSEL);
    return wert === '1' ? true : wert === '0' ? false : null;
  } catch {
    return null;
  }
}

/**
 * Startzustand der Leiste (Nacharbeit 22.09.2026). Eine gemerkte Wahl gewinnt IMMER (sonst
 * drehte sich die Leiste beim Neuladen selbst zurück — dieselbe Regel wie bei der Dichte in
 * `useViewport`). Ohne Wahl startet sie eingeklappt, wo die Karte eng ist — unter `xl`
 * (1200 px). Gemessen ausgeklappt: 222 von 623 px Kartenhöhe bei 375 px Breite, 168 px in drei
 * Zeilen bei 1024 px (dort teilen sich Modulpanel, Karte und Leiste die Breite, die Karte ist
 * rund 440 px schmal); bei 1440 px eine Zeile. Die Leiste ist ein Werkzeug auf Abruf (LFH-353),
 * kein Dauerelement. Rein und exportiert, damit die Vorrangregel ohne Rendern prüfbar ist.
 */
export function startEingeklappt(gemerkt: boolean | null, kartenEng: boolean): boolean {
  return gemerkt ?? kartenEng;
}

function merkeEingeklappt(wert: boolean): void {
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, wert ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
}

/**
 * Die Reihe der gesicherten Stände. Sie teilt sich die Zeile mit Sichern und Zeitleiste
 * (Nacharbeit Neuentwurf, 22.09.2026): ohne `flex`-Basis und `minWidth: 0` nahm sie als
 * Flex-Kind ihre volle Inhaltsbreite an, brach in eine ZWEITE Zeile um und machte die über
 * der Karte liegende Leiste doppelt so hoch — gemessen bei 1440 × 900 rund 100 statt 50 px.
 * Jetzt schrumpft sie auf den Rest der Zeile und rollt waagerecht; erst unter 160 px Rest
 * bricht sie um. Rein und exportiert, damit die Zusicherung ohne Layout prüfbar ist.
 */
export const standLeisteStil: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: '1 1 160px',
  minWidth: 0,
  overflowX: 'auto',
};

/**
 * Das Bezeichnungsfeld neben „Stand sichern" (LFH-373). Vorher fest 180 px breit: seit der
 * Fuß vor der Knopfspalte endet, ist das Band bei 390 px im Handschuh-Betrieb schmaler als
 * Feld plus Knopf — das nicht umbrechbare `Space.Compact` ragte gemessen über den Bandrand
 * und fing die Klicks auf die Kartenknöpfe ab. Jetzt bevorzugt 180 px, schrumpfbar.
 */
export const sichernFeldStil: CSSProperties = { flex: '0 1 180px', minWidth: 0 };

/**
 * Der Zeitleisten-Block (Aktuell · Abspielen · Schieber · Stand). Er darf umbrechen: ohne
 * Umbruch lag seine Mindestbreite (Knöpfe, Schieber ≥ 120, Stand ≥ 96) über der Bandbreite,
 * und nur das Schrumpfen des Abspielknopfs hielt ihn im Band (LFH-373).
 */
export const zeitleisteStil: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  flex: '1 1 260px',
  minWidth: 0,
};

/** Der Abspielknopf schrumpft nicht: als Flex-Kind fiel er gemessen auf 16 px Breite (LFH-373). */
export const abspielenStil: CSSProperties = { flexShrink: 0 };

interface SnapshotLeisteProps {
  einsatzId: number;
  /** „Stand sichern" nur im Live-Modus mit Schreibrecht. */
  darfSichern: boolean;
  /** Aktuell angezeigter Snapshot (`undefined` = Live-Modus). */
  aktiverSnapshotId?: number;
  /** Auswahl eines Standes (`null` = zurück in den Live-Modus). */
  onWaehle: (id: number | null) => void;
  /** Stabiler Fehler-Handler. */
  fehler: (e: unknown) => void;
}

function chipLabel(bezeichnung: string | null | undefined, standAt: string): string {
  // formatZeitKurz (dayjs.utc) statt new Date(): stand_at ist ein naiver UTC-Wire-String
  // ('YYYY-MM-DD HH:MM:SS') → new Date() läse ihn als Lokalzeit (LFH-321-Review).
  return bezeichnung?.trim() || formatZeitKurz(standAt);
}

/**
 * Snapshot-/Zeitachsen-Band unter der Karte (C/LFH-321 + D/LFH-322): „Stand sichern" (Live),
 * die Auswahl gespeicherter Stände (Chips) und der Replay über die Zeitleiste (Slider +
 * Play/Pause mit fester Anzeigedauer, Vorladen des nächsten Dokuments gegen Flackern). Die
 * Auswahl schaltet die Karte über `?snapshot=` in den schreibgeschützten Historien-Modus.
 *
 * Ein-/ausklappbar (LFH-353): das Band liegt über der Karte und ist ein Werkzeug auf Abruf, kein
 * Dauerelement. Eingeklappt bleibt nur ein kleiner Knopf unten links stehen; der Zustand ist
 * per-User gemerkt (localStorage), NICHT Teil der geteilten Ansichts-Konfiguration.
 *
 * **Keine punktuellen Klein-Angaben mehr (LFH-366 · B5f).** Die sieben Steuerelemente hier
 * trugen sie und waren damit auf 30 px festgenagelt — auch im Handschuh-Betrieb. Der Einwand
 * dagegen ist echt und war der Grund für die eigene Betrachtung im Ticket: die Leiste schwebt
 * ÜBER der Karte, grössere Knöpfe verdecken Kartenfläche. Er trägt trotzdem nicht, weil diese
 * Leiste als einzige der Kartenaufbauten bereits eine Antwort auf ihren Flächenverbrauch hat:
 * sie klappt ein (LFH-353), und eingeklappt bleibt genau ein Knopf stehen. Wer die Karte
 * braucht, klappt zu; wer die Zeitachse bedient, braucht sie treffbar. Eine Taste, die man im
 * Handschuh dreimal anfassen muss, kostet mehr Lage als ein Band, das man wegklappen kann.
 *
 * Der Zeilenumbruch ist mitgedacht: der Rahmen trägt `flexWrap: 'wrap'`, die Leiste wird auf
 * höheren Dichtestufen also höher statt breiter und schneidet nichts ab.
 */
export function SnapshotLeiste({
  einsatzId,
  darfSichern,
  aktiverSnapshotId,
  onWaehle,
  fehler,
}: SnapshotLeisteProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { snapshots, sichern, sichertGerade } = useLageSnapshots(einsatzId);
  const [bezeichnung, setBezeichnung] = useState('');
  const [spielt, setSpielt] = useState(false);
  const { abBreite } = useViewport();
  // Abgeleitet statt einmalig gesetzt: die Breitenstufe steht im ersten Render noch nicht
  // fest (antds Breakpoint-Beobachter meldet sich erst nach dem Einhängen), ein
  // `useState`-Startwert läse sie also immer als „breit".
  const [wahl, setWahl] = useState<boolean | null>(gespeichertEingeklappt);
  const eingeklappt = startEingeklappt(wahl, !abBreite('xl'));

  // Chronologisch (alt → neu) für die Zeitleiste; das Backend liefert neueste zuerst.
  const chrono = useMemo(
    () => [...snapshots].sort((a, b) => a.stand_at.localeCompare(b.stand_at)),
    [snapshots],
  );
  const aktiverIndex =
    aktiverSnapshotId != null ? chrono.findIndex((s) => s.id === aktiverSnapshotId) : -1;

  const prefetch = useCallback(
    (id: number) => {
      void qc.prefetchQuery({
        queryKey: einsatzKeys.lageSnapshotDokument(einsatzId, id),
        queryFn: () => ladeLageSnapshot(einsatzId, id),
      });
    },
    [qc, einsatzId],
  );

  // Replay: nach fester Anzeigedauer einen Schritt weiter. Kettet über den aktiverSnapshotId-
  // Wechsel (jeder Schritt aktualisiert ?snapshot= → dieser Effekt läuft neu). Am Ende stoppen.
  useEffect(() => {
    if (!spielt) return;
    const next = aktiverIndex + 1;
    if (next >= chrono.length) {
      setSpielt(false);
      return;
    }
    prefetch(chrono[next].id); // Vorladen → kein Flackern beim Schritt
    const t = setTimeout(() => onWaehle(chrono[next].id), ANZEIGE_MS);
    return () => clearTimeout(t);
  }, [spielt, aktiverIndex, chrono, onWaehle, prefetch]);

  const aufSichern = async () => {
    try {
      await sichern(bezeichnung);
      setBezeichnung('');
      message.success('Stand gesichert');
    } catch (e) {
      fehler(e);
    }
  };

  const aufPlayPause = () => {
    if (spielt) {
      setSpielt(false);
      return;
    }
    if (chrono.length === 0) return;
    // Aus dem Live-Modus oder vom letzten Stand am Anfang der Zeitleiste starten.
    if (aktiverIndex < 0 || aktiverIndex >= chrono.length - 1) onWaehle(chrono[0].id);
    setSpielt(true);
  };

  const zurueckAktuell = () => {
    setSpielt(false);
    onWaehle(null);
  };

  const klappeUm = (zu: boolean) => {
    setWahl(zu);
    merkeEingeklappt(zu);
    // Einklappen stoppt eine laufende Wiedergabe: ein Replay, das die Karte weiterschaltet,
    // während die Pause-Taste nicht sichtbar ist, wäre eine Falle. Der Historien-Modus selbst
    // bleibt bestehen — der Rückweg steht im HistorienBanner.
    if (zu) setSpielt(false);
  };

  // Nichts anzeigen, wenn es weder etwas zu sichern noch etwas zu betrachten gibt.
  if (!darfSichern && snapshots.length === 0) return null;

  if (eingeklappt) {
    return (
      <Tooltip title="Zeitachse einblenden">
        <Button
          icon={<HistoryOutlined />}
          aria-label="Zeitachse einblenden"
          onClick={() => klappeUm(false)}
          style={{
            // Eingeklappt bleibt der Knopf unten links — jetzt als linksbündiges Band im
            // `KartenFuss` (LFH-355) statt absolut positioniert.
            ...bandStil('links'),
            background: token.colorBgElevated,
            boxShadow: token.boxShadow,
          }}
        />
      </Tooltip>
    );
  }

  const marks = Object.fromEntries(chrono.map((_, i) => [i, '']));

  return (
    <div
      // Stabiler Griff für die Überdeckungsmessung in `e2e/lagekarte-smoke.spec.ts`
      // (LFH-355) — die Klassen dieser Leiste sind antd-Interna.
      data-lfh="zeitachse"
      style={{
        // Volle Kartenbreite, aber IM Fuß-Rahmen (LFH-355): absolut positioniert lag dieses
        // Band auf demselben `zIndex: 5` wie die ZeichnenSteuerung und verdeckte sie — als
        // Flow-Band stapeln sich beide, statt sich zu überlagern.
        ...bandStil('voll'),
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: token.borderRadiusLG,
        background: token.colorBgElevated,
        boxShadow: token.boxShadow,
      }}
    >
      {darfSichern && (
        <Space.Compact style={{ minWidth: 0 }}>
          <Input
            placeholder="Bezeichnung (optional)"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            onPressEnter={aufSichern}
            style={sichernFeldStil}
            aria-label="Snapshot-Bezeichnung"
          />
          <Button
            type="primary"
            // Hülle `aria-hidden`: das Symbol brachte sonst sein englisches Label „camera" in den
            // zugänglichen Namen („camera Stand sichern", CLAUDE.md „Ein Emoji ist keine Ikone").
            icon={
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <CameraOutlined />
              </span>
            }
            loading={sichertGerade}
            onClick={aufSichern}
          >
            Stand sichern
          </Button>
        </Space.Compact>
      )}

      {chrono.length > 0 && (
        <div style={zeitleisteStil}>
          <Button type={aktiverSnapshotId == null ? 'primary' : 'default'} onClick={zurueckAktuell}>
            Aktuell
          </Button>
          <Tooltip title={spielt ? 'Pause' : 'Replay abspielen'}>
            <Button
              icon={spielt ? <PauseOutlined /> : <PlayCircleOutlined />}
              onClick={aufPlayPause}
              disabled={chrono.length < 2}
              aria-label={spielt ? 'Pause' : 'Abspielen'}
              style={abspielenStil}
            />
          </Tooltip>
          <Slider
            style={{ flex: 1, margin: '0 8px', minWidth: 120 }}
            min={0}
            max={Math.max(0, chrono.length - 1)}
            value={aktiverIndex >= 0 ? aktiverIndex : 0}
            marks={marks}
            tooltip={{
              formatter: (i) =>
                i != null && chrono[i] ? chipLabel(chrono[i].bezeichnung, chrono[i].stand_at) : '',
            }}
            onChange={(i) => {
              setSpielt(false);
              onWaehle(chrono[i].id);
            }}
            disabled={chrono.length < 2}
            aria-label="Zeitleiste"
          />
          <span style={{ minWidth: 96, fontSize: 12, color: token.colorTextSecondary }}>
            {aktiverIndex >= 0
              ? chipLabel(chrono[aktiverIndex].bezeichnung, chrono[aktiverIndex].stand_at)
              : 'Live'}
          </span>
        </div>
      )}

      {chrono.length > 0 && (
        <div data-lfh="zeitachse-staende" style={standLeisteStil}>
          {chrono.map((s) => (
            <Tooltip key={s.id} title={s.notiz ?? undefined}>
              <Button
                type={s.id === aktiverSnapshotId ? 'primary' : 'default'}
                onClick={() => {
                  setSpielt(false);
                  onWaehle(s.id);
                }}
              >
                {chipLabel(s.bezeichnung, s.stand_at)}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Ganz rechts, `marginLeft: auto` trägt auch dann, wenn der Zeitleisten-Block mit
          seinem flex:1 fehlt (Schreibrecht, aber noch keine Stände). */}
      <Tooltip title="Zeitachse ausblenden">
        <Button
          type="text"
          icon={<DownOutlined />}
          aria-label="Zeitachse ausblenden"
          onClick={() => klappeUm(true)}
          style={{ marginLeft: 'auto' }}
        />
      </Tooltip>
    </div>
  );
}
