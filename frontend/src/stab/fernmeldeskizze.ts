import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import { kommunikationsmittelLabel, teileSprechgruppen } from '../components/kommunikationsmittel';
import {
  baueFuehrungsorganisation,
  type OrgKnoten,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import { fuehrungsstelleErfasst, type FuehrungsstelleQuelle } from './fuehrungsstelle';
import { ZUSTAND_GRUND } from './funkplan';
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
 *   eine Regel, die auch die Lücke im Funkplan zählt. Die Wurzeln urteilen gegen die eigene
 *   Führungsstelle (LFH-849); ohne deren Sprechgruppen, und unter dem Sammelknoten immer,
 *   `ohne-urteil`.
 * - **Wurzel „Einsatzleitung“** trägt die Funkangaben der eigenen Führungsstelle, nie ihre
 *   Erreichbarkeit; nicht erfasst oder nicht geladen nennt sie den Grund.
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md` (D2, D3),
 * Führungsstelle: `openspec/changes/lfh-849-eigene-fuehrungsstelle/design.md` (D5).
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

/** Die Wurzel „Einsatzleitung“: die eigene Führungsstelle, oder warum sie fehlt. */
export type SkizzenWurzel =
  | {
      erfasst: true;
      rufname: string | null;
      tmo: string[];
      dmo: string[];
      kommunikationsmittel: string | null;
    }
  | { erfasst: false; hinweis: string };

export interface Fernmeldeskizze {
  fuehrungsstelle: SkizzenWurzel;
  /** Oberste Abschnitte, danach „Ohne Abschnitt“ (nur, wenn es solche Einheiten gibt). */
  wurzeln: SkizzenKnoten[];
  /** Die Einheiten fehlen (gesperrt/nicht geladen): nur Abschnitte, Hinweis an der Seite. */
  einheitenFehlen: boolean;
}

const OHNE_URTEIL: Kante = { art: 'ohne-urteil' };

function wurzelAus(q: FuehrungsstelleQuelle): SkizzenWurzel {
  if (q.zustand !== 'daten') return { erfasst: false, hinweis: ZUSTAND_GRUND[q.zustand] };
  const fs = q.daten;
  if (!fs || !fuehrungsstelleErfasst(fs)) return { erfasst: false, hinweis: 'nicht erfasst' };
  const { tmo, dmo } = teileSprechgruppen(fs.sprechgruppen);
  return {
    erfasst: true,
    rufname: fs.rufname ?? null,
    tmo: tmo.map((s) => s.bezeichnung),
    dmo: dmo.map((s) => s.bezeichnung),
    kommunikationsmittel: kommunikationsmittelLabel(fs.kommunikationsmittel),
  };
}

/**
 * @param einheiten `null`, wenn die Einheiten nicht vorliegen — ein fehlender Bestand ist kein
 *   leerer. Fehlen die Abschnitte, baut die Seite gar keine Skizze (design.md D5).
 * @param fuehrungsstelle die eigene Führungsstelle (LFH-849): Wurzel und Gegenstelle der ersten
 *   Ebene.
 */
export function baueFernmeldeskizze(
  abschnitte: readonly Einsatzabschnitt[],
  einheiten: readonly Einheit[] | null,
  fuehrungsstelle: FuehrungsstelleQuelle,
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

  // Ohne geladene Führungsstelle keine Gegenstelle: `null` urteilt nicht. Ohne Sprechgruppe
  // urteilt `verbindungsurteil` selbst nicht.
  const fsSprechgruppen =
    fuehrungsstelle.zustand === 'daten' ? (fuehrungsstelle.daten?.sprechgruppen ?? null) : null;
  // Gegen die Führungsstelle urteilt nur ein Abschnitt ohne bekannten Oberabschnitt — wie die
  // Lücke (`verbindungenOhneGemeinsameSprechgruppe`). Ein Ringglied, das das Organigramm als
  // Wurzel aufnimmt, urteilt gegen seinen Oberabschnitt.
  const abschnittJeId = new Map(abschnitte.map((a) => [a.id, a]));
  const obenDerWurzel = (k: OrgKnoten): readonly Sprechgruppe[] | null => {
    if (k.art !== 'abschnitt') return null;
    const a = abschnittJeId.get(k.id);
    const ueber =
      a?.ueber_abschnitt_id != null ? abschnittJeId.get(a.ueber_abschnitt_id) : undefined;
    return ueber ? ueber.sprechgruppen : fsSprechgruppen;
  };
  return {
    fuehrungsstelle: wurzelAus(fuehrungsstelle),
    wurzeln: org.wurzeln.map((k) => umbauen(k, obenDerWurzel(k))),
    einheitenFehlen: org.einheitenFehlen,
  };
}
