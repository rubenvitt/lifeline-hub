import { listeAuftraege } from '../../api/auftraege';
import { ladeBefehl, listeBefehle } from '../../api/befehle';
import { listeDokumentAnlagen, type AnlagenDokument } from '../../api/dokumentAnlagen';
import { ladePersonenDruck } from '../../api/einsatzPerson';
import { listeUhs } from '../../api/einsatzUhs';
import { ladeLagebericht, listeLageberichte } from '../../api/lageberichte';
import type {
  Auftrag,
  BefehlAnzeige,
  DokumentAnlage,
  LageberichtAnzeige,
  Person,
  Uhs,
} from '../../api/types';
import { ladeEtbVollstaendig } from '../../etb/druckAbruf';
import { kettenKoepfe } from '../../lageberichte/ketten';
import {
  berichtZustand,
  eineQuelle,
  ladeEinsatzbericht,
  type EinsatzberichtRoh,
  type QuellenErgebnis,
} from '../einsatzbericht/abruf';
import { berichtFreigabe, modulLabel } from '../einsatzbericht/quellen';
import type { ModulFreigaben } from '../../api/types';
import {
  AKTE_BERICHT_BLOECKE,
  KAPITEL,
  type AkteFreigabe,
  type KapitelSchluessel,
} from './quellen';

/**
 * Abruf der Einsatzakte (LLH-1835, `openspec/changes/archive/2026-11-18-hsdhm2ki-einsatzakte/design.md` D4): alle
 * Kapitel parallel in EINEN Schnappschuss. Jedes Kapitel trägt seinen Zustand wie eine Quelle des
 * Berichts; die Seite druckt nur, wenn alles da ist.
 *
 * Die Betroffenen kommen nur über `GET …/personen/druck` (protokolliert), nie aus einem Cache;
 * deshalb ruft die Seite ohne Retry und mit `gcTime: 0` ab.
 */

export interface DokumentMitAnlagen<D> {
  dokument: D;
  anlagen: DokumentAnlage[];
}

export interface AkteRoh {
  bericht: EinsatzberichtRoh;
  etb: QuellenErgebnis<Awaited<ReturnType<typeof ladeEtbVollstaendig>>>;
  betroffene: QuellenErgebnis<{ personen: Person[]; uhs: Uhs[] }>;
  auftraege: QuellenErgebnis<Auftrag[]>;
  befehle: QuellenErgebnis<DokumentMitAnlagen<BefehlAnzeige>[]>;
  lageberichte: QuellenErgebnis<DokumentMitAnlagen<LageberichtAnzeige>[]>;
  /** Stand des Schnappschusses (ISO, UTC): Beginn des Abrufs. */
  geladenAt: string;
}

/** Je Kette der jüngste freigegebene Stand, älteste Kette zuerst — wie der Server im ZIP. */
function aktuelleFreigegebene<
  K extends { id: number; status: string; vorgaenger_id?: number | null; zeitstand: string },
>(koepfe: readonly K[]): K[] {
  return kettenKoepfe(koepfe.filter((k) => k.status === 'freigegeben'))
    .map((k) => k.kopf)
    .sort((a, b) => a.zeitstand.localeCompare(b.zeitstand) || a.id - b.id);
}

async function ladeDokumente<
  K extends { id: number; status: string; vorgaenger_id?: number | null; zeitstand: string },
  D,
>(
  art: AnlagenDokument,
  einsatzId: number,
  liste: (id: number) => Promise<K[]>,
  laden: (einsatzId: number, id: number) => Promise<D>,
): Promise<DokumentMitAnlagen<D>[]> {
  const koepfe = aktuelleFreigegebene(await liste(einsatzId));
  return Promise.all(
    koepfe.map(async (k) => {
      const [dokument, anlagen] = await Promise.all([
        laden(einsatzId, k.id),
        listeDokumentAnlagen(art, einsatzId, k.id),
      ]);
      return { dokument, anlagen };
    }),
  );
}

export async function ladeEinsatzakte(
  einsatzId: number,
  freigaben: ModulFreigaben,
  freigabe: AkteFreigabe,
): Promise<AkteRoh> {
  const geladenAt = new Date().toISOString();
  const k = freigabe.kapitel;
  const [bericht, etb, betroffene, auftraege, befehle, lageberichte] = await Promise.all([
    ladeEinsatzbericht(einsatzId, berichtFreigabe(freigaben, AKTE_BERICHT_BLOECKE).je),
    eineQuelle(k.etb, () => ladeEtbVollstaendig(einsatzId, {})),
    eineQuelle(k.betroffene, async () => {
      const [personen, uhs] = await Promise.all([
        ladePersonenDruck(einsatzId),
        // Nur für den Namen im Verbleib; ohne UHS-Modul steht „UHS“ ohne Namen.
        listeUhs(einsatzId).catch(() => [] as Uhs[]),
      ]);
      return { personen, uhs };
    }),
    eineQuelle(k.auftraege, () => listeAuftraege(einsatzId)),
    eineQuelle(k.befehle, () => ladeDokumente('befehle', einsatzId, listeBefehle, ladeBefehl)),
    eineQuelle(k.lageberichte, () =>
      ladeDokumente('lageberichte', einsatzId, listeLageberichte, ladeLagebericht),
    ),
  ]);
  return { bericht, etb, betroffene, auftraege, befehle, lageberichte, geladenAt };
}

export type AkteZustand =
  | { art: 'bereit' }
  | { art: 'kein-zugriff'; module: string[] }
  | { art: 'fehler'; module: string[] };

/**
 * Darf gedruckt werden? Wie beim Bericht (`berichtZustand`): kein Zugriff geht dem Fehler vor,
 * gedruckt wird nur, wenn jedes Kapitel und jede Quelle des Berichts da ist oder nicht genutzt.
 */
export function akteZustand(roh: AkteRoh): AkteZustand {
  const bericht = berichtZustand(roh.bericht);
  const sammle = (art: 'kein-zugriff' | 'fehler') => {
    const namen: string[] = bericht.art === art ? [...bericht.module] : [];
    for (const kapitel of KAPITEL) {
      if (kapitel.schluessel === 'bericht') continue;
      if (roh[kapitel.schluessel as Exclude<KapitelSchluessel, 'bericht'>].zustand !== art)
        continue;
      const name = modulLabel(kapitel.modul);
      if (!namen.includes(name)) namen.push(name);
    }
    return namen;
  };
  const ohneZugriff = sammle('kein-zugriff');
  if (ohneZugriff.length > 0) return { art: 'kein-zugriff', module: ohneZugriff };
  const gescheitert = sammle('fehler');
  if (gescheitert.length > 0) return { art: 'fehler', module: gescheitert };
  return { art: 'bereit' };
}
