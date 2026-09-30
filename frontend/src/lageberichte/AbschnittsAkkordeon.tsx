import { IkoneHakenKreis, IkoneMinusKreis } from '../ikonen';
import { Collapse, Typography, theme } from 'antd';
import { memo, type ReactNode } from 'react';
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

/**
 * Dieselbe Aussage als ZEICHENKETTE, ein Zeichen je Abschnitt („1" befüllt, „0" leer).
 * Ein Primitiv als Memo-Abhängigkeit: `befuellteAbschnitte` liefert je Anschlag ein NEUES
 * `Set` und machte jede Memoisierung wertlos; die Kette ändert sich nur, wenn ein Abschnitt
 * kippt. Abgeleitet aus `befuellteAbschnitte`, damit „befüllt" eine Definition hat.
 */
export function befuellungsKette(
  werte: Record<string, unknown> | undefined,
  abschnitte: readonly AbschnittDef[],
): string {
  const voll = befuellteAbschnitte(werte, abschnitte);
  return abschnitte.map((a) => (voll.has(a.schluessel) ? '1' : '0')).join('');
}

/** Die Umkehrung — aus der Kette zurück zur Menge, ohne die Werte erneut zu lesen. */
export function mengeAusKette(
  kette: string,
  abschnitte: readonly AbschnittDef[],
): ReadonlySet<string> {
  const voll = new Set<string>();
  abschnitte.forEach((a, i) => {
    if (kette[i] === '1') voll.add(a.schluessel);
  });
  return voll;
}

interface AbschnittsAkkordeonProps {
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
 * Abschnittsnavigation der Lagebericht-Detailseite: ein Akkordeon, dessen Kopfzeilen die
 * Navigation SIND (alle Abschnitte, leere markiert). Acht ausgeklappte Editoren wären viel zu
 * hoch, ein `Anchor` daneben eine zweite Liste derselben Einträge.
 *
 * Zwei Zusicherungen, beide getestet:
 *  · `forceRender`: alle Editoren stehen im DOM, sonst schickte ein Speichern die zugeklappten
 *    Abschnitte leer.
 *  · Die Leer-Marke trägt zwei Kanäle (WCAG 1.4.1): Ikone in `aria-hidden`-Hülle und das Wort
 *    „(leer)".
 *
 * `memo`, weil die Detailseite über `Form.useWatch([], form)` je Anschlag neu rendert und acht
 * Editoren mit `autoSize`-Nachmessung spürbar bremsen. Die Sperre trägt nur, solange ALLE
 * Props identitätsstabil sind: `abschnitte` aus `VORLAGEN`, `onOffen` als Setter, `befuellt`
 * über `befuellungsKette`/`mengeAusKette`, `editor` per `useCallback`. Ein Verstoß fällt nicht
 * auf — es wird nur wieder langsam.
 */
export const AbschnittsAkkordeon = memo(function AbschnittsAkkordeon({
  abschnitte,
  befuellt,
  offen,
  onOffen,
  editor,
}: AbschnittsAkkordeonProps) {
  const { token } = theme.useToken();
  return (
    <Collapse
      accordion
      activeKey={offen}
      onChange={(k) => {
        // Beim Zuklappen des offenen Abschnitts liefert das Akkordeon nichts; der offene bleibt offen,
        // sonst gäbe es keinen sichtbaren Editor.
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
              <span
                aria-hidden
                style={{ color: voll ? token.colorSuccess : token.colorTextSecondary }}
              >
                {voll ? <IkoneHakenKreis /> : <IkoneMinusKreis />}
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
});
