import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import { useNavigate } from 'react-router';
import { ladeEtbLesemarke, listeEtb, setzeEtbLesemarke } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Sammelbanner, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { etbPfad } from '../routing/deeplinks';
import { lesemarkeLinie, lesemarkeText } from './lesemarkeModell';

/**
 * „14 neue Einträge seit Ihrer letzten Sichtung um 13:04 · alle als gesichtet markieren"
 * (LFH-611).
 *
 * ── ZWEI BANNER, ZWEI FRAGEN ──────────────────────────────────────────────────────────
 *
 * Das Sammelbanner der Zeitachse sagt „während Sie hier waren, kam etwas an" — flüchtig,
 * solange der Fokus drin liegt. Dieses sagt „seit Sie zuletzt als gesichtet markiert haben"
 * — persistent, je Benutzer und Einsatz, serverseitig. Es steht IM FLUSS über der Zeitachse,
 * das andere liegt als Überlagerung auf ihr.
 *
 * ── DIE MARKE RÜCKT NUR AUF KLICK ─────────────────────────────────────────────────────
 *
 * Öffnen oder Blättern verschiebt sie nicht: ein Banner, das sich beim Ansehen selbst löscht,
 * sagte beim nächsten Besuch nichts mehr. Zurückgeschickt wird `hoechste_lfd_nr` der gezeigten
 * Antwort, nicht „alles bis jetzt" — ein Eintrag, der zwischen Anzeige und Klick eintraf, war
 * nicht angesagt und bleibt neu.
 *
 * Live: der Key hängt unter dem ETB-Prefix, jedes `etb`-Ereignis zieht die Zahl nach.
 *
 * Laden und Fehler schweigen: das Banner ist ein Hinweis, keine Datenquelle der Liste. Ein
 * fehlgeschlagenes MARKIEREN meldet sich dagegen am Banner, bis zum nächsten Klick — sonst sähe
 * der Klick wirkungslos aus (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
 *
 * Je Einsatz neu montiert: die Seite bleibt beim Einsatzwechsel stehen, ein alter Grund oder eine
 * spät scheiternde Markierung des vorigen Einsatzes gehört nicht an dieses Banner.
 *
 * ── ZWEI FORMEN (LLH-1149, Funkprotokoll-Ordnung) ─────────────────────────────────────
 *
 * `linie`: eine Trennzeile IN der Zeitachse direkt unter dem zuletzt gesichteten Eintrag, „Neu
 * seit 1304 · 14 Einträge“ — die Zeitachse setzt sie dorthin, die Seite entscheidet, ob sie im
 * Fenster steht (`lesemarkeImFenster`). `banner` (Vorgabe): der Rückfall, wenn die Marke
 * außerhalb des Fensters oder unter einem Filter liegt; dann führt „Zur Marke springen“ hin.
 * Die Seite öffnet in beiden Fällen am Ende (Entscheidung Ruben, 17.10.2026).
 */
export default function EtbLesemarkeBanner({
  einsatzId,
  form = 'banner',
}: {
  einsatzId: number;
  form?: 'banner' | 'linie';
}) {
  return <LesemarkeBanner key={einsatzId} einsatzId={einsatzId} form={form} />;
}

/** Derselbe Abruf wie im Banner — die Seite fragt ihn ab, um Linie oder Banner zu wählen. */
export function useEtbLesemarke(einsatzId: number) {
  return useQuery({
    queryKey: einsatzKeys.etbLesemarke(einsatzId),
    queryFn: () => ladeEtbLesemarke(einsatzId),
  });
}

function LesemarkeBanner({ einsatzId, form }: { einsatzId: number; form: 'banner' | 'linie' }) {
  const { konventionen } = useAnzeigeKonventionen();
  const { token, rollen } = useRollen();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const query = useEtbLesemarke(einsatzId);
  const markieren = useMutation({
    mutationFn: (bisLfdNr: number) => setzeEtbLesemarke(einsatzId, bisLfdNr),
    /*
     * Ein Abruf, der VOR dem Markieren losging, läse die alte Marke und käme nach der Antwort an
     * — `setQueryData` bricht ihn nicht ab, er überschriebe den neuen Stand. Deshalb erst
     * abbrechen und nach dem Setzen frisch lesen: sonst fehlte der Eintrag, dessen Ereignis den
     * abgebrochenen Abruf ausgelöst hatte, bis zum nächsten Ereignis.
     */
    onMutate: () => qc.cancelQueries({ queryKey: einsatzKeys.etbLesemarke(einsatzId) }),
    onSuccess: (neu) => qc.setQueryData(einsatzKeys.etbLesemarke(einsatzId), neu),
    onSettled: () => qc.invalidateQueries({ queryKey: einsatzKeys.etbLesemarke(einsatzId) }),
  });

  const marke = query.data;
  if (marke == null) return null;
  const text =
    form === 'linie' ? lesemarkeLinie(marke, konventionen) : lesemarkeText(marke, konventionen);
  const bis = marke.hoechste_lfd_nr;
  if (text == null || bis == null) return null;
  const markeNr = marke.gesichtet_lfd_nr;

  /*
   * Der Sprung braucht die Kennung, die Marke kennt nur die Nummer: ein Abruf der einen Seite
   * direkt darunter, ohne Filter — unter dem Filter, der das Banner auslöste, stünde die Marke
   * meist nicht. Scheitert er, bleibt die Seite, wie sie ist.
   */
  async function zurMarke(nr: number) {
    try {
      const [ziel] = await listeEtb(einsatzId, { before_lfd_nr: nr + 1, limit: 1 });
      if (ziel) navigate(etbPfad(einsatzId, { eintrag: ziel.id }));
    } catch {
      // kein Ziel, kein Sprung
    }
  }

  const fehler = markieren.error != null && (
    <div style={{ padding: token.paddingXS, borderBlockEnd: `1px solid ${rollen.bannerLinie}` }}>
      <SpeicherFehler
        fehler={markieren.error}
        titel="Nicht als gesichtet markiert"
        fallback="Markieren fehlgeschlagen"
      />
    </div>
  );
  const banner = (
    <Sammelbanner
      aktion={{
        label: 'alle als gesichtet markieren',
        // Riegel gegen den Doppelklick: der Knopf des Banners kennt kein `loading`.
        onKlick: () => {
          if (!markieren.isPending) markieren.mutate(bis);
        },
      }}
      // Im Rahmen der Zeitachse: nur Trennlinien, der Rahmen trägt den Rest.
      style={{
        border: 'none',
        borderBlockEnd: `1px solid ${rollen.bannerLinie}`,
        ...(form === 'linie' ? { borderBlockStart: `1px solid ${rollen.bannerLinie}` } : {}),
      }}
    >
      {text}
      {form === 'banner' && markeNr != null && (
        <>
          {' · '}
          <Button type="link" onClick={() => void zurMarke(markeNr)} style={{ paddingInline: 0 }}>
            Zur Marke springen
          </Button>
        </>
      )}
    </Sammelbanner>
  );

  if (form === 'linie') {
    return (
      <li data-lfh="etb-lesemarke" style={{ listStyle: 'none' }}>
        {banner}
        {fehler}
      </li>
    );
  }
  return (
    <>
      {banner}
      {fehler}
    </>
  );
}
