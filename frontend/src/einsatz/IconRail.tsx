import { Tooltip } from 'antd';
import type { Kategorie, KategorieKey } from './modulRegistry';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/** Schmale vertikale Kategorie-Rail (Ebene 2). */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  return (
    <nav
      aria-label="Kategorien"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: 8,
        background: '#001529', minHeight: '100%',
      }}
    >
      {kategorien.map((k) => {
        const aktiv = k.key === aktiveKategorie;
        const Icon = k.icon;
        return (
          <Tooltip key={k.key} title={k.label} placement="right">
            <button
              type="button"
              aria-label={k.label}
              aria-current={aktiv ? 'true' : undefined}
              onClick={() => onKategorieKlick(k.key)}
              style={{
                width: 48, height: 48, border: 'none', cursor: 'pointer',
                borderRadius: 6, display: 'grid', placeItems: 'center',
                background: aktiv ? '#a8071a' : 'transparent',
                color: aktiv ? '#fff' : 'rgba(255,255,255,0.65)',
              }}
            >
              <Icon size={24} />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
