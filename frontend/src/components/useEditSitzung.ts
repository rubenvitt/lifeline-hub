import { useCallback, useState } from 'react';
import type { FormInstance } from 'antd';

declare const casBasisMarke: unique symbol;

/**
 * Der Baseline-Stand des optimistischen Locks (LFH-241/F10) — ein `geaendert_at`, das beim
 * BETRETEN des Edit-Modus eingefroren wurde.
 *
 * Die Marke ist der Riegel dieses Moduls: `CasBasis` ist nach `string` zuweisbar (die
 * API-Funktionen nehmen `string`), ein blanker `string` aber NICHT nach `CasBasis`. Ein
 * `basis: t.geaendert_at` direkt aus den Live-Query-Daten bricht damit den Typcheck; ein
 * Regex-Guard sähe `const b = t.geaendert_at` nicht, der Typ sieht es.
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
 * (`PersonenDetailPage`, `TiereDetailPage`, `SchaedenDetailPage`, LFH-303).
 *
 * Die Baseline darf nicht beim Absenden aus den Live-Query-Daten kommen: ein
 * Hintergrund-Refetch (`refetchOnWindowFocus`, `refetchOnReconnect`, jede `invalidateQueries`
 * auf den Detail-Key) legte den FREMDEN, neueren Stand in den Cache, der Server verglich ihn
 * mit sich selbst, und die fremde Änderung wäre still überschrieben. Ein abgeschaltetes Flag
 * schlösse nur einen Auslöser; der eingefrorene Stand schließt die Klasse.
 *
 * Das Formular wird MIT befüllt, weil nur so Werte und Basis nachweislich aus einem Snapshot
 * stammen.
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
