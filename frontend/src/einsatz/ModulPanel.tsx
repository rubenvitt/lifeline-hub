import { theme, Typography } from 'antd';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

interface Props {
  titel: string;
  module: ModulEintrag[];
  benutzer: BenutzerAnzeige | null;
  /** Modul-Overrides des Einsatzes (LFH-132); steuert Sichtbarkeit + Rollen-Schranke. */
  overrides?: ModulOverrides;
  aktiverModulKey: string | null;
  onModulKlick: (modul: ModulEintrag) => void;
}

/** Liste der Module einer Kategorie (Ebene 2). */
export default function ModulPanel({
  titel,
  module,
  benutzer,
  overrides,
  aktiverModulKey,
  onModulKlick,
}: Props) {
  const { token } = theme.useToken();
  // Ausgeblendete Module nicht rendern (nicht-ausblendbare bleiben immer sichtbar).
  const sichtbareModule = module.filter((m) => istModulSichtbar(m, overrides));
  return (
    <div
      style={{ width: 220, padding: 12, borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
        {titel}
      </Typography.Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
        {sichtbareModule.map((m) => {
          const gesperrt = istModulGesperrt(m, benutzer, overrides);
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
