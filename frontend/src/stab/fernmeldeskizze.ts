import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import { kommunikationsmittelLabel, teileSprechgruppen } from '../components/kommunikationsmittel';
import {
  baueFuehrungsorganisation,
  type OrgKnoten,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import { verbindungsurteil, type Kante } from './luecken';

/**
 * Die Fernmeldeskizze des Sachgebiets S6 (FwDV 100 Anlage 2, LFH-625) als reine Ableitung — die
 * zweite Darstellung des Funkplans. Keine eigene Datenhaltung und keine eigene Platzierung:
 *
 * - **Baum aus dem Organigramm** (`baueFuehrungsorganisation`): dieselben Knoten und Schlüssel
 *   (`ab-<id>`, `eh-<id>`, `sammel`), zyklussicher. Skizze und Organigramm zeigen einen Baum.
 * - **Funkangaben wie die Tabelle**: Rufname, TMO/DMO und Kommunikationsmittel über dieselben
 *   Funktionen wie `baueFunkplan` (`teileSprechgruppen`, `kommunikationsmittelLabel`).
 * - **Kante zur übergeordneten Stelle** nur über `verbindungsurteil` (`stab/luecken.ts`), die
 *   eine Regel, die auch die Lücke im Funkplan zählt. Wurzeln und Kinder des Sammelknotens haben
 *   keine bekannte Gegenstelle: `ohne-urteil` (die eigene Führungsstelle ist kein Datum, LFH-849).
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md` (D2, D3).
 */

export type SkizzenKnoten =
  | {
      art: 'abschnitt' | 'einheit';
      key: string;
      /** Datenbank-ID — nur für Deeplinks, nie für die Anzeige. */
      id: number;
      name: string;
      /** Abschnitt: Kurzbezeichnung · Einheit: Funkrufname. Nie geraten. */
      rufname: string | null;
      tmo: string[];
      dmo: string[];
      kommunikationsmittel: string | null;
      tz: TzProps;
      /** Die Verbindung zur übergeordneten Stelle. */
      kante: Kante;
      kinder: SkizzenKnoten[];
    }
  | { art: 'sammel'; key: 'sammel'; kinder: SkizzenKnoten[] };

export interface Fernmeldeskizze {
  /** Oberste Abschnitte, danach „Ohne Abschnitt“ (nur, wenn es solche Einheiten gibt). */
  wurzeln: SkizzenKnoten[];
  /** Die Einheiten fehlen (gesperrt/nicht geladen): nur Abschnitte, Hinweis an der Seite. */
  einheitenFehlen: boolean;
}

const OHNE_URTEIL: Kante = { art: 'ohne-urteil' };

/**
 * @param einheiten `null`, wenn die Einheiten nicht vorliegen — ein fehlender Bestand ist kein
 *   leerer. Fehlen die Abschnitte, baut die Seite gar keine Skizze (design.md D5).
 */
export function baueFernmeldeskizze(
  abschnitte: readonly Einsatzabschnitt[],
  einheiten: readonly Einheit[] | null,
): Fernmeldeskizze {
  const org = baueFuehrungsorganisation(abschnitte, einheiten);
  const quelle = new Map<string, Einsatzabschnitt | Einheit>([
    ...abschnitte.map((a) => [`ab-${a.id}`, a] as const),
    ...(einheiten ?? []).map((e) => [`eh-${e.id}`, e] as const),
  ]);

  const umbauen = (k: OrgKnoten, oben: readonly Sprechgruppe[] | null): SkizzenKnoten => {
    if (k.art === 'sammel') {
      return { art: 'sammel', key: 'sammel', kinder: k.kinder.map((c) => umbauen(c, null)) };
    }
    const roh = quelle.get(k.key)!;
    const { tmo, dmo } = teileSprechgruppen(roh.sprechgruppen);
    return {
      art: k.art,
      key: k.key,
      id: k.id,
      name: k.name,
      rufname: k.rufname,
      tmo: tmo.map((s) => s.bezeichnung),
      dmo: dmo.map((s) => s.bezeichnung),
      kommunikationsmittel: kommunikationsmittelLabel(roh.kommunikationsmittel),
      tz: k.tz,
      kante: oben == null ? OHNE_URTEIL : verbindungsurteil(oben, roh.sprechgruppen),
      kinder: k.kinder.map((c) => umbauen(c, roh.sprechgruppen)),
    };
  };

  return {
    wurzeln: org.wurzeln.map((k) => umbauen(k, null)),
    einheitenFehlen: org.einheitenFehlen,
  };
}
