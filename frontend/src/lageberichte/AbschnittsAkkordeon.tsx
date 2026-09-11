import { Collapse, Typography, theme } from 'antd';
import { CheckCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
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
 *
 * Der Zweck ist eine Memo-Abhängigkeit, die ein PRIMITIV ist (CLAUDE.md, Lint-Disziplin:
 * „Primitive statt Objekt in die Deps"). `befuellteAbschnitte` liefert bei jedem
 * Tastenanschlag ein NEUES `Set` mit identischem Inhalt — als Prop reicht das, um jede
 * Memoisierung des Akkordeons wertlos zu machen. Die Kette ändert sich dagegen nur, wenn ein
 * Abschnitt tatsächlich von leer auf befüllt kippt, also ein- oder zweimal je Abschnitt und
 * Sitzung statt vierzig Mal je Satz.
 *
 * Abgeleitet AUS `befuellteAbschnitte`, nicht daneben gebaut: die Frage „was ist befüllt"
 * hat eine Definition, und eine zweite mit eigener Leerraum-Regel wäre die Sorte Abweichung,
 * die niemandem auffällt.
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
 *
 * `memo` IST HIER EINE MESSUNG, KEIN REFLEX (LFH-495, Nachzug N4). Die Detailseite hält mit
 * `Form.useWatch([], form)` die Leer-Marke am Tippen statt am Speichern und rendert dafür je
 * Anschlag neu — mit ihr acht Editoren, die alle `forceRender` tragen und ihre Höhe per
 * `autoSize` nachmessen. Gemessen bei 1366 × 768 (`e2e/lagebericht-tippen.spec.ts`,
 * Anschlag bis Bild): Median 36 ms, p90 73 ms, schlechtester 138 ms — gegen 17 / 30 / 72 ms
 * am Befehlsentwurf, der dieselben Editoren ohne `useWatch` trägt. Der schlechteste Anschlag
 * lag damit über der RAIL-Grenze von 100 ms.
 *
 * Die Sperre trägt nur, solange ALLE vier Props identitätsstabil bleiben: `abschnitte` kommt
 * aus `VORLAGEN` (dasselbe Objekt je Schlüssel), `onOffen` ist ein Setter, `offen` ist eine
 * Zeichenkette — und `befuellt` muss über `befuellungsKette`/`mengeAusKette` laufen, sonst
 * ist es je Anschlag ein neues `Set` und die Memoisierung ein No-op. Wer `editor` inline
 * übergibt statt per `useCallback`, hebt sie ebenso auf; beides fällt nicht auf, weil es
 * nichts kaputt macht — es wird nur wieder langsam.
 */
export const AbschnittsAkkordeon = memo(function AbschnittsAkkordeon({
  abschnitte, befuellt, offen, onOffen, editor,
}: AbschnittsAkkordeonProps) {
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
});
