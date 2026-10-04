import type { AbrufZustand } from '../api/abrufZustand';
import { listeEtb } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { EtbEintragAnzeige, EtbTyp, ModulFreigaben, Stab } from '../api/types';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { DRUCK_SEITE } from '../etb/druckAbruf';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import { etbTypMehrzahl } from '../theme/statusFarben';
import { gesperrt, ladeListe, type Geladen, type UebernahmeQuelle } from './uebernahmeQuelle';

/** Höchstens so viele Entscheidungen, die neuesten zuerst; der Rest als „und n weitere“. */
const LISTE_MAX = 20;

/** Gezählte Typen in fester Reihenfolge; `system` ist Protokoll, keine Lage (LFH-869 D5). */
const GEZAEHLT: readonly EtbTyp[] = [
  'meldung',
  'anordnung',
  'entscheidung',
  'lage',
  'berichtigung',
];

const MODUL = {
  etb: { key: 'etb', name: 'ETB' },
  stab: { key: 'stab', name: 'Stab' },
} as const;

const frei = (m: keyof typeof MODUL, freigaben: ModulFreigaben) =>
  istKeyFreigegeben(MODUL[m].key, freigaben);

const fehlt = (zustand: Exclude<AbrufZustand, 'daten'>) => `- — (${ZUSTAND_GRUND[zustand]})`;

/** Was von einem Eintrag gebraucht wird: kein Freitext im Zwischenspeicher (er wird offline gesichert). */
type NeuerEintrag = Pick<EtbEintragAnzeige, 'lfd_nr' | 'typ' | 'ereigniszeit'>;

interface Neuerungen {
  /** Gezählte neue Einträge (ohne System und Lagevorträge), neueste zuerst. */
  eintraege: NeuerEintrag[];
  /** Der Eintrag der Lagebesprechung lag im ETB; sonst zählt alles seit Einsatzbeginn. */
  grenzeGefunden: boolean;
}

/** Ein freigegebener Lagevortrag schreibt einen `lage`-Eintrag mit `lagebericht_id`. */
const zaehlt = (e: EtbEintragAnzeige) =>
  e.typ !== 'system' && !(e.typ === 'lage' && e.lagebericht_id != null);

/**
 * Die Einträge oberhalb des Eintrags `grenzeId`, in Seiten zu {@link DRUCK_SEITE} über den Cursor
 * `before_lfd_nr` (Muster `etb/druckAbruf.ts`). Gemessen an der laufenden Nummer, nicht an der
 * Ereigniszeit: ein nachgetragener Eintrag ist für den Stab trotzdem neu. Ohne Grenze alle.
 */
async function neueEintraege(einsatzId: number, grenzeId: number | null): Promise<Neuerungen> {
  const eintraege: NeuerEintrag[] = [];
  const nimm = (liste: EtbEintragAnzeige[]) =>
    eintraege.push(
      ...liste
        .filter(zaehlt)
        .map(({ lfd_nr, typ, ereigniszeit }) => ({ lfd_nr, typ, ereigniszeit })),
    );
  let cursor: number | undefined;
  for (;;) {
    const seite = await listeEtb(einsatzId, {
      limit: DRUCK_SEITE,
      ...(cursor != null ? { before_lfd_nr: cursor } : {}),
    });
    // Riegel wie im Druck: eine Seite mit Nummern nicht unterhalb des Cursors liefe ewig.
    if (cursor != null && seite.some((e) => e.lfd_nr >= cursor!)) {
      throw new Error(`ETB-Abruf: Seite liefert Nummern nicht unterhalb des Cursors ${cursor}`);
    }
    const grenze = grenzeId == null ? -1 : seite.findIndex((e) => e.id === grenzeId);
    if (grenze >= 0) {
      nimm(seite.slice(0, grenze));
      return { eintraege, grenzeGefunden: true };
    }
    nimm(seite);
    if (seite.length < DRUCK_SEITE) return { eintraege, grenzeGefunden: false };
    cursor = Math.min(...seite.map((e) => e.lfd_nr));
  }
}

/**
 * „Aus dem ETB übernehmen“ im Abschnitt „Lageentwicklung“ (LFH-873, Variante „Zählbild“, Spec
 * `lagevortrag-uebernahme`): die Zahl neuer ETB-Einträge je Typ seit der letzten abgehaltenen
 * Lagebesprechung und die neuen Entscheidungen mit Nummer und Zeit. Kein Wortlaut: ETB-Freitext
 * kann Dritte nennen, der Vortrag geht bei Freigabe unveränderlich ins ETB.
 */
export const LAGEENTWICKLUNG_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus dem ETB übernehmen',
  unterzeile: 'Neue Einträge je Typ seit der letzten Lagebesprechung, ohne Wortlaut',
  ersetzenTitel: 'Lageentwicklung ersetzen?',
  ersetzenText:
    'Der Abschnitt enthält schon Text. Er wird durch die Zahl der neuen ETB-Einträge seit der letzten Lagebesprechung ersetzt.',
  // Ohne Stab keine Grenze, ohne ETB nichts zu zählen: beide sind nötig.
  verfuegbar: (freigaben) => {
    const fehlend = (Object.keys(MODUL) as (keyof typeof MODUL)[]).filter(
      (m) => !frei(m, freigaben),
    );
    return fehlend.length === 0
      ? { frei: true }
      : {
          frei: false,
          grund: `${fehlend.map((m) => MODUL[m].name).join(' und ')} nicht freigegeben`,
        };
  },
  erzeuge: async ({ qc, einsatzId, freigaben, dtg }) => {
    const stab: Geladen<Stab | null> = frei('stab', freigaben)
      ? await ladeListe(qc, einsatzKeys.stab(einsatzId), () => ladeStab(einsatzId), null)
      : gesperrt(null);
    const letzte = stab.daten?.letzte_lagebesprechung ?? null;
    const grenzeId = letzte?.etb_eintrag_id ?? null;
    const etb: Geladen<Neuerungen | null> =
      stab.zustand === 'daten' && frei('etb', freigaben)
        ? await ladeListe(
            qc,
            // Unter dem ETB-Präfix: ein neuer Eintrag macht auch diesen Stand ungültig.
            einsatzKeys.etbListe(einsatzId, { lageentwicklung: grenzeId }),
            () => neueEintraege(einsatzId, grenzeId),
            null,
          )
        : gesperrt(null);

    const kopf =
      stab.zustand !== 'daten'
        ? '**Neu im ETB seit der letzten Lagebesprechung**'
        : letzte && etb.daten?.grenzeGefunden !== false
          ? `**Neu im ETB seit der Lagebesprechung Nr. ${letzte.lfd_nr} (${dtg(letzte.abgehalten_at)})**`
          : '**Neu im ETB seit Einsatzbeginn**';

    const teile = ((): string[] => {
      if (stab.zustand !== 'daten') return [kopf, fehlt(stab.zustand)];
      if (etb.zustand !== 'daten' || !etb.daten) {
        return [kopf, fehlt(etb.zustand === 'daten' ? 'fehler' : etb.zustand)];
      }
      const neu = etb.daten.eintraege;
      const hinweis =
        letzte && !etb.daten.grenzeGefunden
          ? ['- Der Eintrag der letzten Lagebesprechung fehlt im ETB; gezählt ist alles.']
          : [];
      const zahlen =
        neu.length === 0
          ? ['- keine neuen Einträge']
          : GEZAEHLT.map((t) => `- ${etbTypMehrzahl[t]}: ${neu.filter((e) => e.typ === t).length}`);
      const entscheidungen = neu.filter((e) => e.typ === 'entscheidung');
      const liste =
        entscheidungen.length === 0
          ? ['- keine']
          : [
              ...entscheidungen
                .slice(0, LISTE_MAX)
                .map((e) => `- Nr. ${e.lfd_nr} · ${dtg(e.ereigniszeit)}`),
              ...(entscheidungen.length > LISTE_MAX
                ? [`- und ${entscheidungen.length - LISTE_MAX} weitere`]
                : []),
            ];
      return [kopf, ...hinweis, ...zahlen, '', '**Entscheidungen**', ...liste];
    })();

    const stand = gemeinsamerDatenstand(stab.stand, etb.stand) || Date.now();
    return [`**Stand:** ${dtg(new Date(stand).toISOString())}`, '', ...teile, ''].join('\n');
  },
};
