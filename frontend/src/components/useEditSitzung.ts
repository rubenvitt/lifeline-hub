import { useCallback, useState } from 'react';
import type { FormInstance } from 'antd';

declare const casBasisMarke: unique symbol;

/**
 * Der Baseline-Stand des optimistischen Locks (LFH-241/F10) — ein `geaendert_at`, das
 * beim BETRETEN des Edit-Modus eingefroren wurde.
 *
 * Die Marke ist der eigentliche Riegel dieses Moduls und kein Typ-Schmuck: `CasBasis` ist
 * nach `string` zuweisbar (die API-Funktionen nehmen weiterhin `string`), ein blanker
 * `string` aber NICHT nach `CasBasis`. Ein `basis: t.geaendert_at` direkt aus den
 * Live-Query-Daten — genau der Defekt aus LFH-303 — bricht damit den Typcheck, statt
 * still das Falsche zu senden. Ein Regex-Guard sähe die Schreibweise
 * `const b = t.geaendert_at` nicht; der Typ sieht sie.
 *
 * Erzeugt wird eine `CasBasis` ausschließlich in {@link useEditSitzung}.
 */
export type CasBasis = string & { readonly [casBasisMarke]: 'EditSitzung' };

/** Eine offene Bearbeiten-Sitzung: eingefrorener CAS-Stand plus die Werte, mit denen die
 *  Maske betreten wurde. Beide stammen aus DEMSELBEN Snapshot — das ist die Zusicherung. */
export interface EditSitzung<W> {
  /** `geaendert_at` beim Öffnen der Maske. Überlebt jeden Hintergrund-Refetch. */
  readonly basis: CasBasis;
  /** Formularwerte beim Öffnen — taugen zugleich als `initialValues`. */
  readonly werte: W;
}

/** Minimalvertrag des Datensatzes: nur der Zeitstempel wird gelesen. So nimmt `starte`
 *  den Datensatz statt eines freien Strings — eine fremde Zeichenkette als Basis
 *  unterzuschieben ist damit nicht bloß verboten, sondern nicht formulierbar. */
export interface MitGeaendertAt {
  geaendert_at: string;
}

export interface EditSitzungSteuerung<W> {
  /** `null`, solange der Lesemodus steht. */
  sitzung: EditSitzung<W> | null;
  /** Betritt den Edit-Modus: friert `geaendert_at` ein und befüllt das Formular. */
  starte: (datensatz: MitGeaendertAt, werte: W) => void;
  /** Verlässt den Edit-Modus — Abbrechen, Speichern-Erfolg, „Neu laden" im Konfliktdialog. */
  beende: () => void;
}

/**
 * Die gemeinsame Bearbeiten-Sitzung der drei Seiten mit optimistischem Lock
 * (`PersonenDetailPage`, `TiereDetailPage`, `SchaedenDetailPage`).
 *
 * **Der Defekt, gegen den sie gebaut ist** (LFH-303): Tier- und Schadensseite lasen die
 * Baseline erst im `onFinish` aus den Live-Query-Daten. Der QueryClient fährt
 * `staleTime: 10_000` und lässt TanStacks Vorgaben `refetchOnWindowFocus` /
 * `refetchOnReconnect` (beide `true`) stehen. Wer während offener Maske das Fenster
 * wechselt und nach mehr als zehn Sekunden zurückkommt, bekommt einen
 * Hintergrund-Refetch — im Cache steht dann der FREMDE, neuere Stand. Beim Speichern ging
 * genau der als Baseline raus, der Server verglich den fremden Stand mit sich selbst, die
 * Prüfung passte, und die fremde Änderung war still überschrieben. Also exakt der
 * Lost-Update, den F10 verhindern sollte, nur mit Fensterwechsel als Auslöser.
 *
 * **Warum einfrieren und nicht `refetchOnWindowFocus` abschalten:** der Fensterwechsel ist
 * nur EINER von mehreren Auslösern ohne Nutzeranlass — `refetchOnReconnect` tut bei einem
 * Netzwechsel dasselbe, und jede `invalidateQueries` auf den Detail-Key ebenso. Ein
 * abgeschaltetes Flag schlösse einen Auslöser; der eingefrorene Stand schließt die Klasse.
 *
 * Das Formular wird MIT befüllt, weil nur so Werte und Basis nachweislich aus einem
 * Snapshot stammen: zwei getrennte Aufrufe könnten wieder auseinanderlaufen.
 */
export function useEditSitzung<W extends object>(form: FormInstance<W>): EditSitzungSteuerung<W> {
  const [sitzung, setSitzung] = useState<EditSitzung<W> | null>(null);

  const starte = useCallback(
    (datensatz: MitGeaendertAt, werte: W) => {
      setSitzung({ basis: datensatz.geaendert_at as CasBasis, werte });
      form.setFieldsValue(werte);
    },
    [form],
  );

  const beende = useCallback(() => setSitzung(null), []);

  return { sitzung, starte, beende };
}
