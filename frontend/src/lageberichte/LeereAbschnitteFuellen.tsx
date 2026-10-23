import { Button, Form, type FormInstance } from 'antd';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useRollen } from '../components/instrument';
import { loadAbschnittTexte } from './startinhalt';
import type { UebernahmeQuelle } from './uebernahmeQuelle';
import { standFeld } from './standFeld';
import { zeitpunkt } from '../anzeige/zeitDarstellung';

/** Beschriftung — exportiert, damit Tests sie nicht nachschreiben. */
export const LEERE_FUELLEN = 'Leere Abschnitte aus dem Lagebild füllen';

/** Leer wie in der Gliederung: Leerraum zählt nicht (`entwurf/dokumentEntwurfKern.ts`). */
const isLeer = (wert: unknown) => !(typeof wert === 'string' && wert.trim() !== '');

/**
 * „Leere Abschnitte aus dem Lagebild füllen“ im Kopf der Gliederung (LLH-1081, Spec
 * `lagevortrag-uebernahme`). Füllt in einem Schritt jeden Abschnitt mit Quelle, der leer ist, mit
 * demselben Text wie die Übernahme im Abschnitt (`lageberichte/startinhalt.ts`).
 *
 * - **Ersetzt nichts, fragt deshalb nicht:** geladen werden nur die Quellen der beim Klick leeren
 *   Abschnitte; gesetzt wird nur, was beim Eintreffen noch leer ist (wer währenddessen schreibt,
 *   gewinnt). Die Einzelübernahme mit Rückfrage bleibt daneben.
 * - Ändert nur das Formular und meldet die Änderung EINMAL an den Verlustschutz (`onGeaendert`).
 * - Steht nur, solange ein Abschnitt mit Quelle leer ist. Beobachtet wird ein Wahrheitswert
 *   (`Form.useWatch` mit Selektor): Tippen rendert den Knopf nicht.
 *
 * Die Seite setzt ihn nur im Schreibzweig und nur für eine Vorlage mit Quellen.
 */
export default function LeereAbschnitteFuellen({
  quellen,
  einsatzId,
  form,
  onGeaendert,
}: {
  quellen: Readonly<Record<string, UebernahmeQuelle>>;
  einsatzId: number;
  form: FormInstance;
  onGeaendert: () => void;
}) {
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState(false);

  const selektor = useCallback(
    (werte: Record<string, unknown> | undefined) =>
      werte != null && Object.keys(quellen).some((s) => isLeer(werte[s])),
    [quellen],
  );
  const etwasLeer = Form.useWatch(selektor, form) === true;
  // Während des Ladens bleibt er stehen, auch wenn jemand den letzten leeren Abschnitt füllt.
  if (!etwasLeer && !laeuft) return null;

  const fuellen = async () => {
    const leer = Object.keys(quellen).filter((s) => isLeer(form.getFieldValue(s)));
    setLaeuft(true);
    try {
      const texte = await loadAbschnittTexte(quellen, leer, {
        qc,
        einsatzId,
        dtg: (iso) => zeitpunkt(iso, konventionen),
      });
      let gesetzt = false;
      for (const { schluessel, text, uebernommen_at } of texte) {
        if (!isLeer(form.getFieldValue(schluessel))) continue;
        form.setFieldValue(schluessel, text);
        // Der Stand der Übernahme (LLH-1357) kommt mit dem Text aus `loadAbschnittTexte`.
        form.setFieldValue(standFeld(schluessel), uebernommen_at);
        gesetzt = true;
      }
      if (gesetzt) onGeaendert();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Button
      className="lagebericht-no-print"
      onClick={() => void fuellen()}
      loading={laeuft}
      // In der Spalte der Gliederung (ab `xl` 13rem) bricht die Beschriftung um, statt zu ragen.
      style={{
        whiteSpace: 'normal',
        height: 'auto',
        minHeight: token.controlHeight,
        // Zweizeilig braucht der Text Luft zum Rand; einzeilig hält `minHeight` die Höhe.
        paddingBlock: token.paddingXXS,
        maxWidth: '100%',
        textAlign: 'start',
      }}
    >
      {LEERE_FUELLEN}
    </Button>
  );
}
