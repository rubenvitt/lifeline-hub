import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Slider, Space, theme, Tooltip } from 'antd';
import { CameraOutlined, DownOutlined, HistoryOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { formatZeitKurz } from '../../anzeige/format';
import { useLageSnapshots } from './useLageSnapshots';

/** Feste Anzeigedauer je Stand im Replay (D/LFH-322). */
export const ANZEIGE_MS = 2500;

// Ein-/Ausklappen ist eine Per-User-Anzeigevorliebe, KEINE Ansichts-Konfiguration: die Leiste
// liegt über der Karte und ist ein Werkzeug auf Abruf, kein Dauerelement. Deshalb localStorage
// (Muster wie alarmTon/ThemeModeProvider) und bewusst NICHT der Konfig-Bag von `useKartenAnsicht`
// — dort würde sie geteilt und jede Klapp-Aktion machte die Ansicht schmutzig.
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeitachse-eingeklappt';

function gespeichertEingeklappt(): boolean {
  try {
    return localStorage.getItem(SPEICHER_SCHLUESSEL) === '1';
  } catch {
    return false;
  }
}

function merkeEingeklappt(wert: boolean): void {
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, wert ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
}

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
export function SnapshotLeiste({ einsatzId, darfSichern, aktiverSnapshotId, onWaehle, fehler }: SnapshotLeisteProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { snapshots, sichern, sichertGerade } = useLageSnapshots(einsatzId);
  const [bezeichnung, setBezeichnung] = useState('');
  const [spielt, setSpielt] = useState(false);
  const [eingeklappt, setEingeklappt] = useState(gespeichertEingeklappt);

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
    setEingeklappt(zu);
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
            position: 'absolute',
            bottom: 12,
            left: 12,
            zIndex: 5,
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
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        zIndex: 5,
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
        <Space.Compact>
          <Input
            placeholder="Bezeichnung (optional)"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            onPressEnter={aufSichern}
            style={{ width: 180 }}
            aria-label="Snapshot-Bezeichnung"
          />
          <Button
            type="primary"
            icon={<CameraOutlined />}
            loading={sichertGerade}
            onClick={aufSichern}
          >
            Stand sichern
          </Button>
        </Space.Compact>
      )}

      {chrono.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 260 }}>
          <Button
            type={aktiverSnapshotId == null ? 'primary' : 'default'}
            onClick={zurueckAktuell}
          >
            Aktuell
          </Button>
          <Tooltip title={spielt ? 'Pause' : 'Replay abspielen'}>
            <Button
              icon={spielt ? <PauseOutlined /> : <PlayCircleOutlined />}
              onClick={aufPlayPause}
              disabled={chrono.length < 2}
              aria-label={spielt ? 'Pause' : 'Abspielen'}
            />
          </Tooltip>
          <Slider
            style={{ flex: 1, margin: '0 8px', minWidth: 120 }}
            min={0}
            max={Math.max(0, chrono.length - 1)}
            value={aktiverIndex >= 0 ? aktiverIndex : 0}
            marks={marks}
            tooltip={{ formatter: (i) => (i != null && chrono[i] ? chipLabel(chrono[i].bezeichnung, chrono[i].stand_at) : '') }}
            onChange={(i) => {
              setSpielt(false);
              onWaehle(chrono[i].id);
            }}
            disabled={chrono.length < 2}
            aria-label="Zeitleiste"
          />
          <span style={{ minWidth: 96, fontSize: 12, color: token.colorTextSecondary }}>
            {aktiverIndex >= 0 ? chipLabel(chrono[aktiverIndex].bezeichnung, chrono[aktiverIndex].stand_at) : 'Live'}
          </span>
        </div>
      )}

      {chrono.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
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
