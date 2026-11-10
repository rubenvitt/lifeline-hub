import type { CSSProperties, ReactNode } from 'react';

/** Alle Formen in derselben Rasterzelle: die Zelle ist so breit wie die breiteste. */
const ZELLE: CSSProperties = { gridArea: '1 / 1' };

/**
 * Beschriftung, die die Breite ihrer breitesten Form hält (LLH-1627). Für Kopfaktionen, deren
 * Wortlaut mit den Daten wechselt, etwa „Auflösen“ ↔ „Auflösen (noch 2 Personen)“: der Seitenkopf
 * bricht nach Inhaltsbreite um (`EinsatzSeite`), ein Knopf, der beim Ablegen eines Patienten
 * wächst, schob die Aktionen in eine zweite Zeile und alles darunter nach unten.
 *
 * Die Reserve steht unsichtbar und stumm in derselben Rasterzelle wie der sichtbare Text
 * (`visibility: hidden`, `aria-hidden`), sie zählt weder zum Namen des Knopfs noch zur
 * Lesefolge. Zahlen laufen in Tabellenziffern, damit eine `0` in der Reserve so breit ist wie
 * jede andere Ziffer (Muster `metaPlatzhalter`).
 */
export default function BreiteHalten({
  children,
  reserve,
}: {
  /** Der sichtbare Wortlaut. */
  children: ReactNode;
  /** Die übrigen Formen, deren Breite gehalten wird; Zahlen als `0`. */
  reserve: readonly string[];
}) {
  return (
    <span
      data-lfh="breite-halten"
      style={{ display: 'inline-grid', justifyItems: 'center', fontVariantNumeric: 'tabular-nums' }}
    >
      <span style={ZELLE}>{children}</span>
      {reserve.map((form) => (
        <span key={form} aria-hidden="true" style={{ ...ZELLE, visibility: 'hidden' }}>
          {form}
        </span>
      ))}
    </span>
  );
}
