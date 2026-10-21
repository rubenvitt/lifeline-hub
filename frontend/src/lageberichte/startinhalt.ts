import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { LageberichtAbschnitt, LageberichtVorlageKey, ModulFreigaben } from '../api/types';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import type { UebernahmeKontext, UebernahmeQuelle } from './uebernahmeQuelle';
import { UEBERNAHMEN } from './uebernahmen';
import { standJetzt } from './standFeld';
import { vorlage } from './vorlagen';

/**
 * Mehrere Abschnitte des Lagevortrags in einem Schritt aus dem Lagebild füllen (LLH-1081, Spec
 * `lagevortrag-uebernahme`): beim Anlegen („Neuer Lagevortrag“, EIN POST mit Startinhalt) und im
 * Entwurf („Leere Abschnitte aus dem Lagebild füllen“). Dieselben Quellen wie die Übernahme im
 * Abschnitt (`lageberichte/uebernahmen.ts`), deren `erzeuge` den Wortlaut trägt — keine zweite
 * Verdichtung (`entwurf/AGENTS.md`).
 *
 * Was nicht kommt, steht als „— (Grund)“ im Abschnitt, nie leer und nie als 0: eine Quelle, die
 * für die Person nicht frei ist (ihr eigener Grund, ohne Abruf), Freigaben, die nicht ermittelbar
 * sind, und eine Quelle, die wider ihren Vertrag wirft.
 */

/** Was die Quellen brauchen; die Freigaben lädt der Aufruf selbst. */
export type StartinhaltKontext = Omit<UebernahmeKontext, 'freigaben'>;

/** Derselbe Grund wie der Hinweis der Einzelübernahme (`AbschnittUebernahme`). */
const FREIGABEN_FEHLEN = 'Freigaben nicht ermittelbar';

const ohne = (grund: string) => `— (${grund})`;

/** Über denselben Key wie die Einzelübernahme (gemeinsamer Cache); `null`: nicht ermittelbar. */
async function loadFreigaben(ctx: StartinhaltKontext): Promise<ModulFreigaben | null> {
  try {
    return await ctx.qc.fetchQuery({
      queryKey: einsatzKeys.modulFreigaben(ctx.einsatzId),
      queryFn: () => ladeModulFreigaben(ctx.einsatzId),
    });
  } catch {
    return null;
  }
}

async function textAus(
  quelle: UebernahmeQuelle,
  freigaben: ModulFreigaben | null,
  ctx: StartinhaltKontext,
): Promise<string> {
  if (freigaben == null) return ohne(FREIGABEN_FEHLEN);
  const verfuegbar = quelle.verfuegbar(freigaben);
  if (!verfuegbar.frei) return ohne(verfuegbar.grund);
  try {
    return await quelle.erzeuge({ ...ctx, freigaben });
  } catch {
    return ohne(ZUSTAND_GRUND.fehler);
  }
}

/**
 * Lädt die Texte der genannten Abschnitte parallel, in der Reihenfolge von `schluessel`, je mit
 * dem Stand der Übernahme (`uebernommen_at`, LLH-1357). Ein Schlüssel ohne Quelle fällt heraus.
 * Lädt erst hier, beim Klick (Regel LFH-870).
 */
export async function loadAbschnittTexte(
  quellen: Readonly<Record<string, UebernahmeQuelle>>,
  schluessel: readonly string[],
  ctx: StartinhaltKontext,
): Promise<LageberichtAbschnitt[]> {
  const mitQuelle = schluessel.filter((s) => Object.prototype.hasOwnProperty.call(quellen, s));
  if (mitQuelle.length === 0) return [];
  const freigaben = await loadFreigaben(ctx);
  return Promise.all(
    mitQuelle.map(async (s) => {
      const text = await textAus(quellen[s], freigaben, ctx);
      // Der Stand der Übernahme (LLH-1357): wann dieser Text entstand, auch bei „— (Grund)“.
      return { schluessel: s, text, uebernommen_at: standJetzt() };
    }),
  );
}

/**
 * Startinhalt eines neuen Lageberichts: alle Abschnitte mit Quelle, in der Reihenfolge der
 * Vorlage. `undefined` für eine Vorlage ohne Quellen (der Lagevortrag zur Entscheidung bleibt von
 * Hand, LFH-869): dann legt der Server das leere Skelett an, ohne dass etwas geladen wird.
 */
export async function loadStartinhalt(
  vorlageKey: LageberichtVorlageKey,
  ctx: StartinhaltKontext,
): Promise<LageberichtAbschnitt[] | undefined> {
  const quellen = UEBERNAHMEN[vorlageKey];
  const abschnitte = vorlage(vorlageKey)?.abschnitte;
  if (!quellen || !abschnitte) return undefined;
  return loadAbschnittTexte(
    quellen,
    abschnitte.map((a) => a.schluessel),
    ctx,
  );
}
