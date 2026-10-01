import { useMutation } from '@tanstack/react-query';
import { exportDateiname, speichereDatei } from './dateiSpeichern';

/**
 * CSV-Export einer Einsatzliste (LFH-728): laden, unter einem Dateinamen speichern, Fehler halten.
 *
 * Der Fehler kommt NICHT in den Toast, sondern an die Seite (`fehler` in den `hinweis`-Slot,
 * `SpeicherFehler`, LFH-345) und verschwindet beim nächsten Versuch von selbst. Er gilt nur dem
 * Einsatz, für den er entstand: nach einem Einsatzwechsel auf derselben Seite steht er nicht über
 * der fremden Liste.
 */
export function useCsvExport(
  einsatzId: number,
  inhalt: string,
  laden: (einsatzId: number) => Promise<Blob>,
) {
  const mutation = useMutation({
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
