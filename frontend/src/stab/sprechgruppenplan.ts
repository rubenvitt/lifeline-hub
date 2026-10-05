import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Betriebsart,
  KommunikationsStelle,
  Sprechgruppe,
  Verbindungsstatus,
} from '../api/types';
import {
  einheitDetailPfad,
  einsatzabschnittePfad,
  kommunikationsplanPfad,
} from '../routing/deeplinks';
import { ZUSTAND_GRUND, type FunkplanQuellen } from './funkplan';
import { STELLENART_LABEL } from './kommunikationsplan';
import type { Quelle, SkizzenQuelle } from './luecken';
import { komponentenartWort } from './skizzenZeichen';
import { vergleicheSprechgruppen } from './sprechgruppenOrdnung';

/**
 * Die Kanalbelegung des Funkplans (LFH-848): eine Zeile je Sprechgruppe des Einsatzes mit den
 * Stellen, die auf ihr arbeiten — die dritte Darstellung „Sprechgruppen“ neben Tabelle und Skizze.
 * Reine Ableitung aus denselben `FunkplanQuellen`, keine neuen Daten.
 *
 * - **Menge:** jede an einem Abschnitt oder einer Einheit zugeordnete Sprechgruppe plus jede
 *   einsatzlokale, nach `id` entdoppelt (ein lokaler und ein Katalog-Eintrag können dieselbe
 *   Bezeichnung tragen, wie in `verbindungsurteil`). Ein Katalog-Eintrag ohne Zuordnung ist keine
 *   Sprechgruppe DIESES Einsatzes und fehlt.
 * - **Ordnung:** TMO vor DMO, sonst wie die Quelle (`stab/sprechgruppenOrdnung.ts`).
 * - **Teilnehmer:** Abschnitte (Name, Kurzbezeichnung), dann Einheiten (Name, Funkrufname), je in
 *   der Reihenfolge ihrer Liste, mit Ziel wie im Funkplan. Fehlt eine Strukturquelle, ist „keine
 *   Teilnehmer“ nicht belegbar: die Zelle trägt dann den Grund, bei schon bekannten Teilnehmern
 *   die bekannten plus „unvollständig“.
 * - **Netz (LFH-893):** reicht der Aufrufer Stellen und Skizzendaten mit, tragen auch externe
 *   Stellen des Kommunikationsplans (mit Status, Ziel Kommunikationsplan) und Komponenten der
 *   Skizze (ohne Ziel) Sprechgruppen; beide sind dann eigene Strukturquellen. Eine
 *   Führungsfunktion ist nie Teilnehmer (wie `kanalbelegung` in `stab/luecken.ts`).
 *
 * Herleitung: `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md` (D8),
 * `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`.
 */

export type Herkunft = 'katalog' | 'einsatzlokal';

export const HERKUNFT_LABEL: Record<Herkunft, string> = {
  katalog: 'Katalog',
  einsatzlokal: 'einsatzlokal',
};

export interface SprechgruppenTeilnehmer {
  art: 'abschnitt' | 'einheit' | 'extern' | 'komponente';
  /** `ab-<id>`, `eh-<id>`, `ks-<id>` bzw. `ko-<id>`, wie im Funkplan und in der Skizze. */
  key: string;
  /** Datenbank-ID — nur für Deeplinks, nie für die Anzeige. */
  id: number;
  name: string;
  /** Abschnitt: Kurzbezeichnung · Einheit: Funkrufname. Nie geraten. */
  rufname: string | null;
  /** Pflegeort der Stelle; eine Komponente hat keinen außerhalb der Skizze. */
  ziel: string | null;
  /** Nur externe Stellen und Komponenten (LFH-893 D7): eine geplante Teilnahme ist keine Tatsache. */
  status?: Verbindungsstatus;
}

/** Die zusätzlichen Quellen des Netzes (LFH-893). */
export interface NetzTeilnehmerQuellen {
  stellen: Quelle<KommunikationsStelle>;
  skizze: SkizzenQuelle;
}

type Strukturquelle = 'abschnitte' | 'einheiten' | 'stellen' | 'skizze';

export interface FehlendeStruktur {
  quelle: Strukturquelle;
  name: string;
  zustand: Exclude<AbrufZustand, 'daten'>;
}

/**
 * Was über die Teilnehmer feststeht. `vollstaendig` mit leerer Liste ist das belegte „keine“;
 * ohne alle Strukturquellen gibt es nur `unvollstaendig` (bekannte Teilnehmer) oder `unbekannt`.
 */
export type TeilnehmerAngabe =
  | { art: 'vollstaendig'; teilnehmer: SprechgruppenTeilnehmer[] }
  | { art: 'unvollstaendig'; teilnehmer: SprechgruppenTeilnehmer[]; fehlend: FehlendeStruktur[] }
  | { art: 'unbekannt'; fehlend: FehlendeStruktur[] };

export interface SprechgruppenZeile {
  /** `sg-<id>`. */
  key: string;
  /** Datenbank-ID — nie für die Anzeige. */
  id: number;
  bezeichnung: string;
  betriebsart: Betriebsart;
  /** Der Zweck des Kanals steht im `hinweis` der Sprechgruppe (design.md, Non-Goals). */
  hinweis: string | null;
  herkunft: Herkunft;
  teilnehmer: TeilnehmerAngabe;
}

const STRUKTUR_NAME: Record<Strukturquelle, string> = {
  abschnitte: 'Abschnitte',
  einheiten: 'Einheiten',
  stellen: 'Externe Stellen',
  skizze: 'Daten der Skizze',
};
/** Aus dem Record, nicht als Literal: `['abschnitte', …]` läse der Query-Key-Guard als Key. */
const STRUKTUR = Object.keys(STRUKTUR_NAME) as Strukturquelle[];

export function baueSprechgruppenplan(
  q: FunkplanQuellen,
  einsatzId: number,
  netz?: NetzTeilnehmerQuellen,
): SprechgruppenZeile[] {
  const abschnitte = q.abschnitte.zustand === 'daten' ? q.abschnitte.daten : [];
  const einheiten = q.einheiten.zustand === 'daten' ? q.einheiten.daten : [];
  const zustandJe: Partial<Record<Strukturquelle, AbrufZustand>> = {
    abschnitte: q.abschnitte.zustand,
    einheiten: q.einheiten.zustand,
    ...(netz ? { stellen: netz.stellen.zustand, skizze: netz.skizze.zustand } : {}),
  };
  const fehlend: FehlendeStruktur[] = STRUKTUR.flatMap((quelle) => {
    const zustand = zustandJe[quelle];
    return zustand == null || zustand === 'daten'
      ? []
      : [{ quelle, name: STRUKTUR_NAME[quelle], zustand }];
  });

  const gruppen = new Map<number, Sprechgruppe>();
  const teilnehmer = new Map<number, SprechgruppenTeilnehmer[]>();
  const trage = (s: Sprechgruppe, t: SprechgruppenTeilnehmer) => {
    if (!gruppen.has(s.id)) gruppen.set(s.id, s);
    const bisher = teilnehmer.get(s.id);
    if (bisher) bisher.push(t);
    else teilnehmer.set(s.id, [t]);
  };

  for (const a of abschnitte) {
    const t: SprechgruppenTeilnehmer = {
      art: 'abschnitt',
      key: `ab-${a.id}`,
      id: a.id,
      name: a.name,
      rufname: a.kurzbezeichnung ?? null,
      ziel: einsatzabschnittePfad(einsatzId, { abschnitt: a.id }),
    };
    // Aus den Zuordnungen (0073), nie aus `sprechgruppe_tmo/_dmo` (0047, eingefroren).
    for (const s of a.sprechgruppen) trage(s, t);
  }
  for (const e of einheiten) {
    const t: SprechgruppenTeilnehmer = {
      art: 'einheit',
      key: `eh-${e.id}`,
      id: e.id,
      name: e.name,
      rufname: e.funkrufname ?? null,
      ziel: einheitDetailPfad(einsatzId, e.id),
    };
    for (const s of e.sprechgruppen) trage(s, t);
  }
  if (netz?.stellen.zustand === 'daten') {
    const ziel = kommunikationsplanPfad(einsatzId);
    for (const st of netz.stellen.daten) {
      if (st.stellenart === 'funktion') continue;
      for (const { sprechgruppe, status } of st.sprechgruppen) {
        trage(sprechgruppe, {
          art: 'extern',
          key: `ks-${st.id}`,
          id: st.id,
          name: st.bezeichnung?.trim() || STELLENART_LABEL[st.stellenart],
          rufname: null,
          ziel,
          status,
        });
      }
    }
  }
  if (netz?.skizze.zustand === 'daten') {
    for (const ko of netz.skizze.daten?.komponenten ?? []) {
      const t: SprechgruppenTeilnehmer = {
        art: 'komponente',
        key: `ko-${ko.id}`,
        id: ko.id,
        name: ko.bezeichnung?.trim() || komponentenartWort(ko.art),
        rufname: null,
        ziel: null,
        status: 'bestehend',
      };
      for (const s of ko.sprechgruppen) trage(s, t);
    }
  }
  // Ohne Liste fehlen nur die lokalen ohne Zuordnung; die Seite nennt den Grund.
  if (q.sprechgruppen.zustand === 'daten') {
    for (const s of q.sprechgruppen.daten) {
      if (s.einsatz_lokal && !gruppen.has(s.id)) gruppen.set(s.id, s);
    }
  }

  const angabe = (liste: SprechgruppenTeilnehmer[]): TeilnehmerAngabe => {
    if (fehlend.length === 0) return { art: 'vollstaendig', teilnehmer: liste };
    if (liste.length > 0) return { art: 'unvollstaendig', teilnehmer: liste, fehlend };
    return { art: 'unbekannt', fehlend };
  };

  return [...gruppen.values()].sort(vergleicheSprechgruppen).map((s) => ({
    key: `sg-${s.id}`,
    id: s.id,
    bezeichnung: s.bezeichnung,
    betriebsart: s.betriebsart,
    hinweis: s.hinweis?.trim() ? s.hinweis : null,
    herkunft: s.einsatz_lokal ? 'einsatzlokal' : 'katalog',
    teilnehmer: angabe(teilnehmer.get(s.id) ?? []),
  }));
}

/** Der Grund einer offenen Teilnehmerzelle: „Einheiten nicht freigegeben“. */
export function fehlendText(fehlend: readonly FehlendeStruktur[]): string {
  return fehlend.map((f) => `${f.name} ${ZUSTAND_GRUND[f.zustand]}`).join(', ');
}

const LEER_QUELLEN = [
  { quelle: 'abschnitte', name: 'Abschnitte' },
  { quelle: 'einheiten', name: 'Einheiten' },
  { quelle: 'sprechgruppen', name: 'Sprechgruppen' },
] as const;

/**
 * Leertext der Darstellung: „keine Sprechgruppe“ nur, wenn alle drei Quellen der Menge geladen
 * sind. Sonst der Grund, gruppiert wie beim Leertext der Tabelle.
 */
export function sprechgruppenplanLeerText(q: FunkplanQuellen): string {
  const jeGrund = new Map<string, string[]>();
  for (const { quelle, name } of LEER_QUELLEN) {
    const { zustand } = q[quelle];
    if (zustand === 'daten') continue;
    const grund = ZUSTAND_GRUND[zustand];
    jeGrund.set(grund, [...(jeGrund.get(grund) ?? []), name]);
  }
  if (jeGrund.size === 0) return 'Keine Sprechgruppe im Einsatz zugeordnet oder angelegt';
  return `Keine Zeilen darstellbar — ${[...jeGrund]
    .map(([grund, namen]) => `${namen.join(', ')}: ${grund}`)
    .join(' · ')}`;
}
