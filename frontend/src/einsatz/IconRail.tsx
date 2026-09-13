import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { abstand, farbenDunkel, form } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/**
 * Breite der Rail. Layoutmaß, keine Trefffläche — deshalb ein Festwert und kein Token:
 * sie bemisst sich am längsten Etikett („Kräfte & Mittel", zweizeilig), nicht an der
 * Bediendichte. Dieselbe Kategorie wie die 220 in `ModulPanel.tsx:230`.
 */
const RAIL_BREITE = 76;

/**
 * A1-Trefflächenboden (Festlegung 4, Material 48 dp). Die Rail trug ihn bis LFH-337 als
 * feste Höhe; seit dem sichtbaren Etikett ist er der BODEN unter der Dichte-Staffel.
 */
const TREFFLAECHE = 48;

/**
 * Stil eines Kategorie-Ziels — REIN und exportiert, damit die Dichte-Zusicherung ohne
 * Rendern prüfbar ist.
 *
 * `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme: `useToken()`
 * liefert dort den antd-Seed (`controlHeight: 32`), also KEINE der Stufen 30/48/72. Ein
 * gerenderter Wert belegte antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin
 * kein Layout. Präzedenzen: `ModulPanel.modulZeilenStil`, `Sidebar.bedienzielStil`.
 *
 * `Math.max` und NICHT `??`: mit `??` fiele die kompakte Stufe auf 30 px und damit unter
 * den A1-Boden, den die Rail seit LFH-329 trägt — die Staffel würde den Boden senken,
 * statt ihn zu heben (dieselbe gemessene Falle wie in `ModulPanel.tsx:29-31`).
 *
 * ZWEI Angaben, nicht eine (LFH-365): `minHeight` PLUS Polsterung. Aufgelöste Tokens,
 * nie `var(--lfh-*)` — die Arbeitsteilung steht in `theme/rollen.css`.
 */
export function railZielStil(
  token: { controlHeight: number; padding: number; paddingSM: number; fontSizeSM: number },
  zustand: { aktiv: boolean },
): CSSProperties {
  return {
    width: '100%',
    minHeight: Math.max(TREFFLAECHE, token.controlHeight),
    padding: `${token.paddingSM}px ${Math.min(token.padding, 8)}px`,
    border: 'none',
    cursor: 'pointer',
    borderRadius: form.radiusSteuer,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    // `farbenDunkel.bedien`, nicht `token.colorPrimary`: die Rail ist in BEIDEN Modi
    // dunkel (Grund und Text kommen darunter ebenfalls aus `farbenDunkel`). Der helle
    // Bedien-Token auf dunklem Grund liefe auf 2,93:1 und verfehlte WCAG 1.4.11 (3:1 für
    // Zustandsanzeige); der Dunkelmodus-Wert liefert 8,67:1.
    background: zustand.aktiv ? farbenDunkel.bedien : 'transparent',
    color: zustand.aktiv ? farbenDunkel.text : farbenDunkel.gedaempft,
  };
}

/**
 * Schmale vertikale Kategorie-Rail (Ebene 2).
 *
 * DAS ETIKETT STEHT SICHTBAR, NICHT IM TOOLTIP (LFH-337 · Befund H8). Bis dahin trug die
 * Rail sechs unbeschriftete Ikonen, deren Text nur beim Zeigen erschien — auf dem
 * Führungs-Tablet (Touch, Handschuhe, im Stehen) gibt es kein Hover, die oberste
 * Navigationsebene war dort also vollständig unbeschriftet. Der Tooltip ist deshalb
 * ersatzlos weg: er sagte dasselbe noch einmal, nur unzuverlässig.
 *
 * DER AKTIVE ZUSTAND IST BEDIENUNG, NICHT MARKE (LFH-328/A2, Spec §1.2). Er trug bis
 * A2 die Markenfarbe als hartes Hex — genau die rote Bedienfläche, die „Rot bedient nichts"
 * (LFH-315/A0) verbietet: Rot ist Gefahr oder Marke, ein aktiver Navigations-Button ist
 * weder. Die Farbe kommt deshalb aus der Bedienrolle. Wer sie auf `colorError` zurückdreht,
 * dreht eine getestete Entscheidung zurück (`IconRail.test.tsx` pinnt beides).
 */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  const { token } = theme.useToken();
  return (
    <nav
      aria-label="Kategorien"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: abstand.xs,
        padding: abstand.sm,
        background: farbenDunkel.grund,
        minHeight: '100%',
        width: RAIL_BREITE,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {kategorien.map((k) => {
        const aktiv = k.key === aktiveKategorie;
        const Icon = k.icon;
        return (
          <button
            key={k.key}
            type="button"
            // `aria-label` bleibt trotz sichtbaren Textes: er ist wortgleich, hält aber die
            // Namensabfrage stabil, falls das Etikett je gekürzt dargestellt wird.
            aria-label={k.label}
            aria-current={aktiv ? 'true' : undefined}
            onClick={() => onKategorieKlick(k.key)}
            style={railZielStil(token, { aktiv })}
          >
            {/* `flexShrink: 0`, weil sonst die Ikone statt des Etiketts nachgibt —
                dieselbe gemessene Falle wie in `ModulPanel.tsx:157-158`. */}
            <Icon size={22} style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: token.fontSizeSM,
                lineHeight: 1.15,
                textAlign: 'center',
                // Zwei Zeilen sind erlaubt und für „Kräfte & Mittel" nötig; `hyphens`
                // verhindert, dass ein langes Wort über den Rail-Rand hinausläuft.
                overflowWrap: 'anywhere',
                hyphens: 'auto',
              }}
            >
              {k.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
