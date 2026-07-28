import { Tooltip } from 'antd';
import { abstand, farbenDunkel, form } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/**
 * Schmale vertikale Kategorie-Rail (Ebene 2).
 *
 * DER AKTIVE ZUSTAND IST BEDIENUNG, NICHT MARKE (LFH-328/A2, Spec §1.2). Er trug bis
 * A2 die Markenfarbe als hartes Hex — genau die rote Bedienfläche, die „Rot bedient nichts"
 * (LFH-315/A0) verbietet: Rot ist Gefahr oder Marke, ein aktiver Navigations-Button ist
 * weder. Die Farbe kommt deshalb aus `colorPrimary`. Wer sie auf `colorError` zurückdreht,
 * dreht eine getestete Entscheidung zurück (`IconRail.test.tsx` pinnt beides).
 *
 * Die Rail ist in BEIDEN Modi eine dunkle Fläche — Text und Grund kommen deshalb bewusst
 * aus `farbenDunkel`, nicht aus dem modusabhängigen Token.
 */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  return (
    <nav
      aria-label="Kategorien"
      style={{
        display: 'flex', flexDirection: 'column', gap: abstand.xs, padding: abstand.sm,
        background: farbenDunkel.grund, minHeight: '100%',
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
                // 48 px bleibt: das ist die Treffläche der Rail (A1 Festlegung 4,
                // Material 48 dp), keine Dichte-Angabe an einem Steuerelement.
                width: 48, height: 48, border: 'none', cursor: 'pointer',
                borderRadius: form.radiusSteuer, display: 'grid', placeItems: 'center',
                // `farbenDunkel.bedien`, nicht `token.colorPrimary`: die Rail ist in
                // BEIDEN Modi dunkel (Grund und Text kommen darunter ebenfalls aus
                // `farbenDunkel`). Der helle Bedien-Token auf dunklem Grund liefe auf
                // 2,93:1 und verfehlte WCAG 1.4.11 (3:1 für Zustandsanzeige); der
                // Dunkelmodus-Wert liefert 8,67:1.
                background: aktiv ? farbenDunkel.bedien : 'transparent',
                color: aktiv ? farbenDunkel.text : farbenDunkel.gedaempft,
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
