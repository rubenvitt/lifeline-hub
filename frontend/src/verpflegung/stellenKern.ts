/**
 * Verpflegungsstellen — reiner Kern der Anzeige (LLH-1040, design.md D13).
 *
 * Das Ist je Stelle rechnet allein der Server (`je_stelle` aus `deckung::rechne`); hier wird nur
 * gewählt, geordnet und benannt, nie summiert. Die Uhr kommt herein (`useUhr` der Seite).
 *
 * - {@link laufendeZeitfensterDerStelle}: die Zeile der Stellenliste („Mittag 12:00–13:30 · 100 EP“).
 * - {@link zeilenJeStelle}: die Aufstellung unter „ausgegeben“ an der Zeitfensterkarte.
 * - {@link stellenWahl}: die Reihenfolge jeder Stellenwahl (zugeordnete zuerst, aufgelöste getrennt).
 * - {@link eigeneStelle}: die feste Stelle eines gebundenen Verpflegungsgeräts (LLH-1048).
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { GeraetAnzeige, Verpflegungsstelle, VerpflegungZeitfenster } from '../api/types';
import { istVergangen } from './deckung';

dayjs.extend(utc);

export interface LaufendesZeitfenster {
  zeitfenster: VerpflegungZeitfenster;
  /** EP, die an der Stelle in diesem Zeitfenster ausgegeben sind (aus `je_stelle`). */
  ausgegeben: number;
}

/** Hat begonnen (`von ≤ jetzt`) und ist nicht vergangen. */
function isLaufend(zf: VerpflegungZeitfenster, jetzt: Dayjs): boolean {
  const von = dayjs.utc(zf.von_at);
  return von.isValid() && von.valueOf() <= jetzt.valueOf() && !istVergangen(zf, jetzt);
}

/**
 * Die laufenden Zeitfenster einer Stelle, nach Beginn: jedes, dem die Stelle zugeordnet ist oder
 * das an ihr eine Ausgabe hat (dann steht sie in `je_stelle`). Ein zugeordnetes ohne Ausgabe zählt
 * mit 0.
 */
export function laufendeZeitfensterDerStelle(
  stelleId: number,
  zeitfenster: readonly VerpflegungZeitfenster[],
  jetzt: Dayjs,
): LaufendesZeitfenster[] {
  return zeitfenster
    .filter((zf) => isLaufend(zf, jetzt))
    .flatMap((zf) => {
      const eintrag = zf.je_stelle.find((e) => e.stelle_id === stelleId);
      if (!eintrag && !zf.stelle_ids.includes(stelleId)) return [];
      return [{ zeitfenster: zf, ausgegeben: eintrag?.ausgegeben.gesamt ?? 0 }];
    })
    .sort((a, b) => a.zeitfenster.von_at.localeCompare(b.zeitfenster.von_at));
}

export interface ZeileJeStelle {
  /** `null` = „ohne Stelle“. */
  stelleId: number | null;
  bezeichnung: string;
  ausgegeben: number;
  /** Wörter neben der Menge: „aufgelöst“, „nicht zugeordnet“. */
  kennzeichen: string[];
}

/** Bezeichnung einer Stelle; eine unbekannte Kennung bleibt sichtbar statt still zu fehlen. */
export function stellenName(
  stelleId: number,
  stellen: readonly Pick<Verpflegungsstelle, 'id' | 'bezeichnung'>[],
): string {
  return stellen.find((s) => s.id === stelleId)?.bezeichnung ?? `Stelle #${stelleId}`;
}

/**
 * Zeilen der Aufstellung je Stelle in der Reihenfolge des Servers, „ohne Stelle“ zuletzt. Leer,
 * wenn `je_stelle` leer ist: der Bestand ohne Stelle zeigt dann keine Aufstellung.
 */
export function zeilenJeStelle(
  zf: VerpflegungZeitfenster,
  stellen: readonly Verpflegungsstelle[],
): ZeileJeStelle[] {
  const mitStelle: ZeileJeStelle[] = [];
  const ohne: ZeileJeStelle[] = [];
  for (const e of zf.je_stelle) {
    if (e.stelle_id == null) {
      ohne.push({
        stelleId: null,
        bezeichnung: 'ohne Stelle',
        ausgegeben: e.ausgegeben.gesamt,
        kennzeichen: [],
      });
      continue;
    }
    const s = stellen.find((x) => x.id === e.stelle_id);
    const kennzeichen: string[] = [];
    if (s?.status === 'aufgeloest') kennzeichen.push('aufgelöst');
    if (!zf.stelle_ids.includes(e.stelle_id)) kennzeichen.push('nicht zugeordnet');
    mitStelle.push({
      stelleId: e.stelle_id,
      bezeichnung: stellenName(e.stelle_id, stellen),
      ausgegeben: e.ausgegeben.gesamt,
      kennzeichen,
    });
  }
  return [...mitStelle, ...ohne];
}

export interface StellenWahl {
  /** Dem Zeitfenster zugeordnet und nicht aufgelöst. */
  zugeordnet: Verpflegungsstelle[];
  /** Übrige nicht aufgelöste. */
  weitere: Verpflegungsstelle[];
  /** Aufgelöste, die zugeordneten zuerst; wählbar nur für Nachträge vor der Auflösung. */
  aufgeloest: Verpflegungsstelle[];
}

/** Reihenfolge jeder Stellenwahl; innerhalb der Gruppen die Folge des Servers (Bezeichnung). */
export function stellenWahl(
  stellen: readonly Verpflegungsstelle[],
  zf: Pick<VerpflegungZeitfenster, 'stelle_ids'> | null,
): StellenWahl {
  const zugeordnet = new Set(zf?.stelle_ids ?? []);
  const offen = stellen.filter((s) => s.status !== 'aufgeloest');
  const aufgeloest = stellen.filter((s) => s.status === 'aufgeloest');
  return {
    zugeordnet: offen.filter((s) => zugeordnet.has(s.id)),
    weitere: offen.filter((s) => !zugeordnet.has(s.id)),
    aufgeloest: [
      ...aufgeloest.filter((s) => zugeordnet.has(s.id)),
      ...aufgeloest.filter((s) => !zugeordnet.has(s.id)),
    ],
  };
}

/** Zahl der Segmentleiste „Stellen (n)“: nicht aufgelöste Stellen. */
export function offeneStellenCount(stellen: readonly Verpflegungsstelle[]): number {
  return stellen.filter((s) => s.status !== 'aufgeloest').length;
}

/**
 * Die Verpflegungsstelle, an die das Gerät gebunden ist (LLH-1048, Entscheidung LLH-1024 F7);
 * `null` am Desktop, am einsatzweiten Verpflegungsgerät und an jeder anderen Ansicht. An ihr
 * steht die Stelle fest: keine Stellenwahl, jede Ausgabe trägt sie (der Server setzt sie auch
 * ohne Angabe und lehnt eine andere mit 403 ab). Der Name kommt aus der live geführten Lesung
 * (`stellen`, nach einer Umbenennung neu), sonst aus der Sitzung (`geraet.stelle`).
 */
export function eigeneStelle(
  geraet: Pick<GeraetAnzeige, 'ansicht' | 'stelle_id' | 'stelle'> | null | undefined,
  stellen: readonly Pick<Verpflegungsstelle, 'id' | 'bezeichnung'>[],
): { id: number; bezeichnung: string } | null {
  if (geraet?.ansicht !== 'verpflegung' || geraet.stelle_id == null) return null;
  const id = geraet.stelle_id;
  return {
    id,
    bezeichnung:
      stellen.find((s) => s.id === id)?.bezeichnung ?? geraet.stelle ?? stellenName(id, stellen),
  };
}
