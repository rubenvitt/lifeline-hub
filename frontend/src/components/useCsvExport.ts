import { useMutation } from '@tanstack/react-query';
import { exportDateiname, speichereDatei, type ExportInhalt } from './dateiSpeichern';

/**
 * CSV-Export einer Einsatzliste (LFH-728): laden, unter einem Dateinamen speichern, Fehler halten.
 *
 * Der Fehler kommt NICHT in den Toast, sondern an die Seite (`fehler` in den `hinweis`-Slot,
 * `SpeicherFehler`, LFH-345) und verschwindet beim nächsten Versuch von selbst. Er gilt nur dem
 * Einsatz, für den er entstand: nach einem Einsatzwechsel auf derselben Seite steht er nicht über
 * der fremden Liste.
 *
 * `networkMode: 'always'`: mit TanStacks Vorgabe pausierte der Export ohne Netz — der Knopf
 * drehte ohne Meldung, und nach der Rückkehr der Verbindung liefe er ungefragt nach (beim
 * Personen-Export samt Audit-Eintrag), womöglich Minuten später und auf einer anderen Seite. So
 * scheitert er sofort mit `NetzFehler` und meldet sich an der Seite.
 */
export function useCsvExport(
  einsatzId: number,
  inhalt: ExportInhalt,
  laden: (einsatzId: number) => Promise<Blob>,
) {
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: async (id: number) => {
      const datei = await laden(id);
      speichereDatei(datei, exportDateiname(inhalt, id));
    },
  });
  const fuerDiesen = mutation.variables === einsatzId;
  return {
    exportieren: () => mutation.mutate(einsatzId),
    laeuft: fuerDiesen && mutation.isPending,
    fehler: fuerDiesen ? mutation.error : null,
  };
}
