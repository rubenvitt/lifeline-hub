import { theme, Typography } from 'antd';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

interface ListeProps {
  module: ModulEintrag[];
  benutzer: BenutzerAnzeige | null;
  /** Modul-Overrides des Einsatzes (LFH-132); steuert Sichtbarkeit + Rollen-Schranke. */
  overrides?: ModulOverrides;
  aktiverModulKey: string | null;
  onModulKlick: (modul: ModulEintrag) => void;
  /**
   * Mindesthöhe eines Modulknopfes in Pixeln. Ohne Angabe bleibt die Liste
   * kompakt — das ist der inline-Rahmen am Fükw-Schirm (Maus, viele Zeilen im
   * Blick). Der Navigations-Drawer ist dagegen der Berührungsfall und setzt
   * hier das A1-Maß; das ist eine Trefffläche, keine Dichte-Angabe.
   */
  mindestTrefflaeche?: number;
}

interface Props extends ListeProps {
  titel: string;
}

/**
 * Die Modulknöpfe einer Kategorie — ohne Rahmen, ohne Titel, ohne feste Breite.
 *
 * Eigener Export, weil es zwei Träger gibt: das {@link ModulPanel} im inline-
 * Rahmen und das Akkordeon im Navigations-Drawer unter antds `lg`-Schwelle
 * (LFH-329 · B1/H11). Die Sichtbarkeits- und Sperrlogik samt der Regel, dass
 * 🚧/🔒/↗ reine Dekoration bleiben, darf es nur EINMAL geben — zwei Kopien
 * driften genau an der Stelle auseinander, die niemand testet.
 */
export function ModulListe({
  module,
  benutzer,
  overrides,
  aktiverModulKey,
  onModulKlick,
  mindestTrefflaeche,
}: ListeProps) {
  const { token } = theme.useToken();
  // Ausgeblendete Module nicht rendern (nicht-ausblendbare bleiben immer sichtbar).
  const sichtbareModule = module.filter((m) => istModulSichtbar(m, overrides));
  return (
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
              minHeight: mindestTrefflaeche,
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
            {/* Dekoration neben dem Label — `aria-hidden` wie beim ↗ darunter, sonst
                landet der Emoji im Accessible Name des Knopfes („Stab 🚧"). */}
            {m.status === 'wip' && (
              <span title="In Arbeit" aria-hidden>
                🚧
              </span>
            )}
            {m.verweistAuf && (
              <span title="Öffnet in der Lagekarte" aria-hidden style={{ marginLeft: 'auto' }}>
                ↗
              </span>
            )}
            {/* Ebenfalls Dekoration: die Sperre trägt der Knopf selbst über `disabled`
                und `title="Keine Berechtigung"`, nicht der Emoji. */}
            {gesperrt && (
              <span aria-hidden style={{ marginLeft: 'auto' }}>
                🔒
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Liste der Module einer Kategorie im inline-Rahmen (Ebene 2). */
export default function ModulPanel({ titel, ...liste }: Props) {
  const { token } = theme.useToken();
  return (
    <div
      style={{ width: 220, padding: 12, borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
        {titel}
      </Typography.Text>
      <ModulListe {...liste} />
    </div>
  );
}
