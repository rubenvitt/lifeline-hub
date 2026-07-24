import { useState } from 'react';
import { App, Button, Input, Space, theme, Tooltip } from 'antd';
import { CameraOutlined } from '@ant-design/icons';
import { useLageSnapshots } from './useLageSnapshots';

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
  const zeit = (() => {
    const d = new Date(standAt);
    return Number.isNaN(d.getTime())
      ? standAt
      : d.toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  })();
  return bezeichnung?.trim() || zeit;
}

/**
 * Snapshot-/Zeitachsen-Band unter der Karte (C/LFH-321): „Stand sichern" (Live-Modus) plus die
 * Auswahl gespeicherter Stände. Die Auswahl schaltet die Karte über `?snapshot=` in den
 * schreibgeschützten Historien-Modus. D (LFH-322) erweitert dieses Band um Slider + Play/Pause.
 */
export function SnapshotLeiste({ einsatzId, darfSichern, aktiverSnapshotId, onWaehle, fehler }: SnapshotLeisteProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { snapshots, sichern, sichertGerade } = useLageSnapshots(einsatzId);
  const [bezeichnung, setBezeichnung] = useState('');

  const aufSichern = async () => {
    try {
      await sichern(bezeichnung);
      setBezeichnung('');
      message.success('Stand gesichert');
    } catch (e) {
      fehler(e);
    }
  };

  // Nichts anzeigen, wenn es weder etwas zu sichern noch etwas zu betrachten gibt.
  if (!darfSichern && snapshots.length === 0) return null;

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

      {snapshots.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
          <Button
            size="small"
            type={aktiverSnapshotId == null ? 'primary' : 'default'}
            onClick={() => onWaehle(null)}
          >
            Aktuell
          </Button>
          {snapshots.map((s) => (
            <Tooltip key={s.id} title={s.notiz ?? undefined}>
              <Button
                size="small"
                type={s.id === aktiverSnapshotId ? 'primary' : 'default'}
                onClick={() => onWaehle(s.id)}
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
