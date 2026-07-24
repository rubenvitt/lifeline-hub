import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Slider, Space, theme, Tooltip } from 'antd';
import { CameraOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { formatZeitKurz } from '../../anzeige/format';
import { useLageSnapshots } from './useLageSnapshots';

/** Feste Anzeigedauer je Stand im Replay (D/LFH-322). */
export const ANZEIGE_MS = 2500;

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
 */
export function SnapshotLeiste({ einsatzId, darfSichern, aktiverSnapshotId, onWaehle, fehler }: SnapshotLeisteProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { snapshots, sichern, sichertGerade } = useLageSnapshots(einsatzId);
  const [bezeichnung, setBezeichnung] = useState('');
  const [spielt, setSpielt] = useState(false);

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

  // Nichts anzeigen, wenn es weder etwas zu sichern noch etwas zu betrachten gibt.
  if (!darfSichern && snapshots.length === 0) return null;

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
            size="small"
            placeholder="Bezeichnung (optional)"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            onPressEnter={aufSichern}
            style={{ width: 180 }}
            aria-label="Snapshot-Bezeichnung"
          />
          <Button
            size="small"
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
            size="small"
            type={aktiverSnapshotId == null ? 'primary' : 'default'}
            onClick={zurueckAktuell}
          >
            Aktuell
          </Button>
          <Tooltip title={spielt ? 'Pause' : 'Replay abspielen'}>
            <Button
              size="small"
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
                size="small"
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
    </div>
  );
}
