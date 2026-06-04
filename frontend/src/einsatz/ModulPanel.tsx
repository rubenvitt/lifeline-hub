import { theme, Typography } from 'antd';
import { istModulGesperrt, type ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

interface Props {
  titel: string;
  module: ModulEintrag[];
  benutzer: BenutzerAnzeige | null;
  aktiverModulKey: string | null;
  onModulKlick: (modul: ModulEintrag) => void;
}

/** Liste der Module einer Kategorie (Ebene 2). */
export default function ModulPanel({
  titel,
  module,
  benutzer,
  aktiverModulKey,
  onModulKlick,
}: Props) {
  const { token } = theme.useToken();
  return (
    <div
      style={{ width: 220, padding: 12, borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
        {titel}
      </Typography.Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
        {module.map((m) => {
          const gesperrt = istModulGesperrt(m, benutzer);
          const aktiv = m.key === aktiverModulKey;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              disabled={gesperrt}
              title={gesperrt ? 'Keine Berechtigung' : undefined}
              onClick={() => !gesperrt && onModulKlick(m)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                border: 'none',
                borderRadius: 6,
                textAlign: 'left',
                width: '100%',
                cursor: gesperrt ? 'not-allowed' : 'pointer',
                background: aktiv ? token.colorPrimaryBg : 'transparent',
                color: gesperrt ? token.colorTextDisabled : aktiv ? token.colorPrimary : 'inherit',
              }}
            >
              <Icon size={18} />
              <span>{m.label}</span>
              {m.status === 'wip' && <span title="In Arbeit">🚧</span>}
              {m.verweistAuf && (
                <span title="Öffnet in der Lagekarte" aria-hidden style={{ marginLeft: 'auto' }}>
                  ↗
                </span>
              )}
              {gesperrt && <span style={{ marginLeft: 'auto' }}>🔒</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
