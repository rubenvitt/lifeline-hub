import { Collapse, Typography, theme } from 'antd';
import { CheckCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { AbschnittDef } from './vorlagen';

/**
 * Welche Abschnitte tragen Text? Rein und exportiert, damit die Marke ohne Render prüfbar
 * ist. Leerraum zählt nicht — ein Abschnitt aus drei Leerzeichen ist leer.
 */
export function befuellteAbschnitte(
  werte: Record<string, unknown> | undefined,
  abschnitte: readonly AbschnittDef[],
): Set<string> {
  const voll = new Set<string>();
  for (const a of abschnitte) {
    const t = werte?.[a.schluessel];
    if (typeof t === 'string' && t.trim()) voll.add(a.schluessel);
  }
  return voll;
}

export interface AbschnittsAkkordeonProps {
  abschnitte: readonly AbschnittDef[];
  /** Aus `befuellteAbschnitte` über `Form.useWatch`. */
  befuellt: ReadonlySet<string>;
  /** Schlüssel des offenen Abschnitts — genau einer, kontrolliert. */
  offen: string;
  onOffen: (schluessel: string) => void;
  /** Der Editor je Abschnitt (ein `Form.Item`). Wird für ALLE gerendert (`forceRender`). */
  editor: (abschnitt: AbschnittDef) => ReactNode;
}

/**
 * Abschnittsnavigation der Lagebericht-Detailseite (LFH-348 · C13, Befund H62).
 *
 * WARUM EIN AKKORDEON UND KEIN `Anchor`, obwohl das Ticket den nennt — gemessen: die
 * Bestandsseite mit acht Split-Editoren à acht Zeilen war 2108 px hoch
 * (`e2e/lagebericht-schmal.spec.ts`, 1366 × 768), das Ticket verlangt die Halbierung
 * (≤ 1054 px). Acht ausgeklappte Editoren erreichen das in keiner Bauform: schon bei
 * vier Mindestzeilen je Feld liegt allein das Formular über 1200 px. Der Körper der Seite
 * hat zudem einen Boden von `100vh` (`AppLayout`/`EinsatzLayout`, `minHeight`), 768 px
 * sind also das Minimum. Bleibt: EIN offener Editor, sieben Kopfzeilen — und die Kopfzeilen
 * SIND die Navigation. Sie listen alle Abschnitte, markieren die leeren und springen mit
 * einem Klick, ohne dass die Seite scrollt. Ein zusätzlicher `Anchor` daneben wäre eine
 * zweite Liste derselben acht Einträge.
 *
 * Die Vorlagen haben keine Reihenfolge-Logik (`Steps` entfällt): jeder Abschnitt ist
 * jederzeit erreichbar, das Akkordeon erzwingt nichts.
 *
 * ZWEI ZUSICHERUNGEN, beide getestet:
 *  · `forceRender`: alle Editoren stehen im DOM, auch die zugeklappten. Sonst hätte
 *    `Form` die Werte der geschlossenen Abschnitte nicht, und ein Speichern schickte sie
 *    leer — derselbe Grund, aus dem die Erfassungs-Norm `forceRender` an einem `Collapse`
 *    im Formular verlangt (CLAUDE.md, „Feldbudget").
 *  · Die Leer-Marke trägt ZWEI Kanäle (WCAG 1.4.1): Ikone in `aria-hidden`-Hülle und das
 *    Wort „(leer)" im Kopfzeilentext. Ein antd-Icon bringt sonst `role="img"` mit
 *    englischem Namen mit und stünde in jeder Zeile als eigenes Vorleseziel.
 */
export function AbschnittsAkkordeon({ abschnitte, befuellt, offen, onOffen, editor }: AbschnittsAkkordeonProps) {
  const { token } = theme.useToken();
  return (
    <Collapse
      accordion
      activeKey={offen}
      onChange={(k) => {
        // Akkordeon liefert den Schlüssel oder — beim Zuklappen des offenen — nichts.
        // Ein Bericht ohne offenen Abschnitt hätte keinen sichtbaren Editor; der offene
        // bleibt deshalb offen.
        const naechster = Array.isArray(k) ? k[0] : k;
        if (typeof naechster === 'string') onOffen(naechster);
      }}
      items={abschnitte.map((a) => {
        const voll = befuellt.has(a.schluessel);
        return {
          key: a.schluessel,
          forceRender: true,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}>
              <span aria-hidden style={{ color: voll ? token.colorSuccess : token.colorTextSecondary }}>
                {voll ? <CheckCircleOutlined /> : <MinusCircleOutlined />}
              </span>
              <Typography.Text strong={voll} type={voll ? undefined : 'secondary'}>
                {a.label}
                {voll ? '' : ' (leer)'}
              </Typography.Text>
            </span>
          ),
          children: editor(a),
        };
      })}
    />
  );
}
