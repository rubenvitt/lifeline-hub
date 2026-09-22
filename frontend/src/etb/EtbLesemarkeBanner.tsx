import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { ApiError } from '../api/client';
import { ladeEtbLesemarke, setzeEtbLesemarke } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Sammelbanner, useRollen } from '../components/instrument';
import { lesemarkeText } from './lesemarkeModell';

/**
 * „14 neue Einträge seit Ihrer letzten Sichtung um 13:04 · alle als gesichtet markieren"
 * (LFH-611, Neuentwurf S4).
 *
 * ── ZWEI BANNER, ZWEI FRAGEN ──────────────────────────────────────────────────────────
 *
 * Das Sammelbanner der Zeitachse (`EtbZeitachse`) sagt „während Sie hier im Tagebuch
 * waren, kam etwas an" — flüchtig, solange der Fokus drin liegt. Dieses hier sagt „seit Sie
 * das Tagebuch zuletzt als gesichtet markiert haben" — persistent, je Benutzer und Einsatz,
 * serverseitig. Es steht IM FLUSS über der Zeitachse wie im Entwurf, das andere liegt als
 * Überlagerung auf ihr; beide stehen nie am selben Platz.
 *
 * ── DIE MARKE RÜCKT NUR AUF KLICK ─────────────────────────────────────────────────────
 *
 * Öffnen oder Blättern verschiebt sie nicht: der Entwurf trägt die Aktion ausdrücklich, und
 * ein Banner, das sich beim Ansehen selbst löscht, sagte beim nächsten Besuch nichts mehr.
 * Zurückgeschickt wird `hoechste_lfd_nr` der gezeigten Antwort, nicht „alles bis jetzt" —
 * ein Eintrag, der zwischen Anzeige und Klick eintraf, war nicht angesagt und bleibt neu.
 *
 * Live: der Key hängt unter dem ETB-Prefix, jedes `etb`-Ereignis zieht die Zahl nach.
 *
 * Laden und Fehler schweigen. Das Banner ist ein Hinweis über der Liste, keine Datenquelle
 * der Liste; deren eigener Fehlerzustand steht darüber. Ein fehlgeschlagenes MARKIEREN
 * dagegen meldet sich — das Banner bliebe sonst stumm stehen, und der Klick sähe wirkungslos
 * aus.
 */
export default function EtbLesemarkeBanner({ einsatzId }: { einsatzId: number }) {
  const { konventionen } = useAnzeigeKonventionen();
  const { rollen } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: einsatzKeys.etbLesemarke(einsatzId),
    queryFn: () => ladeEtbLesemarke(einsatzId),
  });
  const markieren = useMutation({
    mutationFn: (bisLfdNr: number) => setzeEtbLesemarke(einsatzId, bisLfdNr),
    /*
     * Ein Abruf, der VOR dem Markieren losging (etwa durch ein `etb`-Ereignis kurz vor dem
     * Klick), läse die alte Marke und käme nach der Antwort an — `setQueryData` bricht ihn
     * nicht ab, er überschriebe den neuen Stand, und das Banner stünde wieder da. Deshalb
     * erst abbrechen, und nach dem Setzen frisch lesen: sonst fehlte der Eintrag, dessen
     * Ereignis den abgebrochenen Abruf ausgelöst hatte, bis zum nächsten Ereignis.
     * Gemessen: jede der beiden Angaben schließt das Fenster schon allein (das Nachlesen
     * bricht einen laufenden Abruf ebenfalls ab); der Test wird erst rot, wenn beide fehlen.
     */
    onMutate: () => qc.cancelQueries({ queryKey: einsatzKeys.etbLesemarke(einsatzId) }),
    onSuccess: (neu) => qc.setQueryData(einsatzKeys.etbLesemarke(einsatzId), neu),
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Markieren als gesichtet fehlgeschlagen'),
    onSettled: () => qc.invalidateQueries({ queryKey: einsatzKeys.etbLesemarke(einsatzId) }),
  });

  const marke = query.data;
  if (marke == null) return null;
  const text = lesemarkeText(marke, konventionen);
  const bis = marke.hoechste_lfd_nr;
  if (text == null || bis == null) return null;

  return (
    <Sammelbanner
      aktion={{
        label: 'alle als gesichtet markieren',
        // Riegel gegen den Doppelklick: der Knopf des Banners kennt kein `loading`.
        onKlick: () => {
          if (!markieren.isPending) markieren.mutate(bis);
        },
      }}
      // Im Rahmen der Zeitachse: nur die Trennlinie nach unten, der Rahmen trägt den Rest.
      style={{ border: 'none', borderBlockEnd: `1px solid ${rollen.bannerLinie}` }}
    >
      {text}
    </Sammelbanner>
  );
}
