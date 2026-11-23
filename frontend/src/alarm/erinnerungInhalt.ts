import type { QueryClient } from '@tanstack/react-query';
import { listeOffeneErinnerungen } from '../api/erinnerungen';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungEreignis, Erinnerung } from '../api/types';
import { INHALT_FRIST_MS } from './meldungInhalt';

/**
 * Titel einer fälligen Erinnerung im Hinweis (LLH-1737, Spec `benachrichtigungen`, „Fällige
 * Erinnerung erreicht ihre Empfänger“, design.md D6 in `openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/`).
 *
 * Der Titel ist ein Scrub-Wert: der Server nennt ihn weder im Live-Ereignis noch im Text der
 * Benachrichtigung (`src/benachrichtigung/text.rs`). Einen Einzelabruf gibt es nicht; der Client
 * nimmt ihn aus der Liste der offenen Erinnerungen, unter demselben Key wie Erinnerungsseite und
 * Überblick (`einsatzKeys.erinnerungenPhase(id, 'offen')`). Ein gefüllter Cache antwortet sofort.
 * Den Empfänger lässt der Server nur zu, wenn er das Modul lesen darf. Wie beim Inhalt einer
 * Meldung (`meldungInhalt.ts`) gilt die Frist {@link INHALT_FRIST_MS}; danach steht der Hinweis
 * mit dem Text des Servers.
 */
export function ladeErinnerungTitel(
  e: Pick<BenachrichtigungEreignis, 'art' | 'bezug_typ' | 'bezug_id' | 'einsatz_id'>,
  qc?: QueryClient | null,
): Promise<string | null> {
  const einsatzId = e.einsatz_id;
  if (e.art !== 'erinnerung_faellig' || e.bezug_typ !== 'erinnerung' || einsatzId == null) {
    return Promise.resolve(null);
  }
  const holen = () => listeOffeneErinnerungen(einsatzId);
  const liste: Promise<Erinnerung[]> = qc
    ? qc.fetchQuery({
        queryKey: einsatzKeys.erinnerungenPhase(einsatzId, 'offen'),
        queryFn: holen,
        // Eine Liste, die Überblick oder Erinnerungsseite gerade geholt haben, reicht.
        staleTime: 30_000,
      })
    : holen();
  const abruf = liste.then(
    (eintraege) => eintraege.find((x) => x.id === e.bezug_id)?.titel?.trim() || null,
    () => null,
  );
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((fertig) => {
    uhr = setTimeout(() => fertig(null), INHALT_FRIST_MS);
  });
  return Promise.race([abruf, frist]).finally(() => clearTimeout(uhr));
}
