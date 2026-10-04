import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '../api/client';
import { patcheFuehrungsstelle } from '../api/einsaetze';
import { patcheEinheit } from '../api/einheiten';
import { patcheAbschnitt } from '../api/einsatzabschnitte';
import {
  aendereBereich,
  aendereKomponente,
  aendereSkizzenVerbindung,
  entferneBereich,
  entferneKomponente,
  entferneSkizzenVerbindung,
  legeBereichAn,
  legeKomponenteAn,
  legeSkizzenVerbindungAn,
  loeseSprechgruppe,
  ordneSprechgruppeZu,
  setzeSchriftfeld,
  setzeSkizzenLage,
  verwerfeSkizzenLage,
  type ZuordnungsZiel,
} from '../api/fernmeldeskizze';
import { legeKommunikationsStelleAn } from '../api/kommunikationsplan';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Fernmeldeskizze,
  KommunikationsStelle,
  ModulFreigaben,
  SkizzenLage,
} from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import {
  darfImEinsatzSchreiben,
  type BenutzerSchreibkontext,
  type EinsatzSchreibkontext,
} from '../einsatz/schreibrecht';
import type { NetzRechte } from './fernmeldeskizze';
import type { SkizzenAktionen } from './skizzenAktionen';

/**
 * Die Schreibwege der Fernmeldeskizze (LFH-893, `stab/skizzenAktionen.ts`) gegen das API
 * (`api/fernmeldeskizze.ts`, design.md D5, D14).
 *
 * - **Cache wie beim Kommunikationsplan:** Antworten mit Datensatz (Lage, Komponente, Verbindung,
 *   Bereich, Schriftfeld, Führungsstelle, Plan) setzt der Hook per `setQueryData`; Antworten ohne
 *   Körper (Zuordnungen, Entfernen) invalidieren die Liste des Datensatzes. Das Live-Ereignis des
 *   Servers (`abschnitt`, `einheit`, `einsatz`, `stab`) erreicht dieselben Keys in jedem anderen
 *   Tab; die Skizzendaten hängen unter dem Stab-Prefix.
 * - **Zuordnung am Datensatz** (D5): `ab-`, `eh-`, `fs`, `ks-`, `ko-` am Pfad des Datensatzes;
 *   Rufname und Kommunikationsmittel über dessen PATCH (Abschnitt `kurzbezeichnung`, Einheit
 *   `funkrufname`, Führungsstelle `rufname`), je nur das eine Feld.
 * - **409** (abweichende Version): der Hook holt den Stand des Servers und reicht den Fehler
 *   weiter; die Fläche meldet ihn am Element (`befehlsGrund`).
 * - **Ohne Schreibrecht im Einsatz** gibt es keine Aktionen (`null`, D8): die Fläche ist dann
 *   schreibgeschützt. Das Recht je Element liest das Netz aus {@link skizzenRechte}.
 */

/** Das Recht je Quelle (D5, D8): Schreibrecht im Einsatz und, wo es eins gibt, das Modul frei. */
export function skizzenRechte(
  einsatz: EinsatzSchreibkontext,
  benutzer: BenutzerSchreibkontext,
  freigaben: ModulFreigaben | undefined,
): NetzRechte {
  const schreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const frei = (key: string) => schreiben && istKeyFreigegeben(key, freigaben);
  return {
    einsatzabschnitte: frei('einsatzabschnitte'),
    einheiten: frei('einheiten'),
    // `EinsatzVerwaltungszugriff`: Schreibrecht oder Admin im aktiven Einsatz, kein Modul.
    verwaltung: schreiben,
    stab: frei('stab'),
  };
}

/** Netzschlüssel → Datensatz (`fs`, `ab-<id>`, `eh-<id>`, `ks-<id>`, `ko-<id>`). */
function zielAus(stelle: string): ZuordnungsZiel {
  if (stelle === 'fs') return { art: 'fuehrungsstelle' };
  const m = /^(ab|eh|ks|ko)-(\d+)$/.exec(stelle);
  if (!m) throw new Error(`Unbekannte Stelle „${stelle}“`);
  const id = Number(m[2]);
  const art = ({ ab: 'abschnitt', eh: 'einheit', ks: 'stelle', ko: 'komponente' } as const)[
    m[1] as 'ab' | 'eh' | 'ks' | 'ko'
  ];
  return { art, id };
}

function aendereSkizze(
  qc: QueryClient,
  einsatzId: number,
  aenderung: (alt: Fernmeldeskizze) => Fernmeldeskizze,
): void {
  qc.setQueryData<Fernmeldeskizze>(einsatzKeys.stabFernmeldeskizze(einsatzId), (alt) =>
    alt ? aenderung(alt) : alt,
  );
}

function mitLage(alt: Fernmeldeskizze, lage: SkizzenLage): Fernmeldeskizze {
  return { ...alt, lage: [...alt.lage.filter((l) => l.element !== lage.element), lage] };
}

function ersetze<T extends { id: number }>(liste: readonly T[], neu: T): T[] {
  return liste.some((x) => x.id === neu.id)
    ? liste.map((x) => (x.id === neu.id ? neu : x))
    : [...liste, neu];
}

export function useSkizzenAktionen(
  einsatzId: number,
  darfSchreiben: boolean,
): SkizzenAktionen | null {
  const qc = useQueryClient();
  const aktionen = useMemo<SkizzenAktionen>(() => {
    const skizzeKey = einsatzKeys.stabFernmeldeskizze(einsatzId);
    const holeSkizze = () => qc.invalidateQueries({ queryKey: skizzeKey });
    /** Bei einer abweichenden Version gilt der Stand des Servers (D4). */
    const beiKonflikt = async <T>(aufruf: Promise<T>): Promise<T> => {
      try {
        return await aufruf;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) void holeSkizze();
        throw e;
      }
    };
    /** Die Liste, in der die Zuordnung eines Datensatzes steht. */
    const holeDatensatz = (ziel: ZuordnungsZiel) => {
      switch (ziel.art) {
        case 'abschnitt':
          return qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
        case 'einheit':
          return qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
        case 'fuehrungsstelle':
          return qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungsstelle(einsatzId) });
        case 'stelle':
          // Die Kanäle externer Stellen zählen zum Stand der Skizze.
          return Promise.all([
            qc.invalidateQueries({ queryKey: einsatzKeys.stabKommunikationsplan(einsatzId) }),
            holeSkizze(),
          ]);
        case 'komponente':
          return holeSkizze();
      }
    };
    const feldDesDatensatzes = async (
      stelle: string,
      feld: 'rufname' | 'kommunikationsmittel',
      wert: string | null,
    ) => {
      const ziel = zielAus(stelle);
      switch (ziel.art) {
        case 'abschnitt':
          await patcheAbschnitt(
            einsatzId,
            ziel.id,
            feld === 'rufname' ? { kurzbezeichnung: wert } : { kommunikationsmittel: wert },
          );
          await holeDatensatz(ziel);
          return;
        case 'einheit':
          await patcheEinheit(
            einsatzId,
            ziel.id,
            feld === 'rufname' ? { funkrufname: wert } : { kommunikationsmittel: wert },
          );
          await holeDatensatz(ziel);
          return;
        case 'fuehrungsstelle': {
          const fs = await patcheFuehrungsstelle(
            einsatzId,
            feld === 'rufname' ? { rufname: wert } : { kommunikationsmittel: wert },
          );
          qc.setQueryData(einsatzKeys.fuehrungsstelle(einsatzId), fs);
          return;
        }
        default:
          // Externe Stellen und Komponenten tragen weder Rufname noch Kommunikationsmittel.
          throw new Error(`„${stelle}“ trägt kein Feld ${feld}`);
      }
    };

    return {
      async verschiebe(element, lage, version) {
        const neu = await beiKonflikt(
          setzeSkizzenLage(einsatzId, element, {
            x: lage.x,
            y: lage.y,
            ...(lage.breite !== undefined ? { breite: lage.breite } : {}),
            version,
          }),
        );
        aendereSkizze(qc, einsatzId, (alt) => mitLage(alt, neu));
        return neu;
      },
      async neuAnordnen() {
        await verwerfeSkizzenLage(einsatzId);
        aendereSkizze(qc, einsatzId, (alt) => ({ ...alt, lage: [] }));
      },

      async ordneZu(stelle, sprechgruppeId, status) {
        const ziel = zielAus(stelle);
        await ordneSprechgruppeZu(einsatzId, ziel, sprechgruppeId, status);
        await holeDatensatz(ziel);
      },
      async loese(stelle, sprechgruppeId) {
        const ziel = zielAus(stelle);
        await loeseSprechgruppe(einsatzId, ziel, sprechgruppeId);
        await holeDatensatz(ziel);
      },

      async legeVerbindungAn(von, nach, felder) {
        const v = await legeSkizzenVerbindungAn(einsatzId, { von, nach, ...felder });
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          verbindungen: ersetze(alt.verbindungen, v),
        }));
        return v;
      },
      async aendereVerbindung(id, felder) {
        const v = await beiKonflikt(aendereSkizzenVerbindung(einsatzId, id, felder));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          verbindungen: ersetze(alt.verbindungen, v),
        }));
        return v;
      },
      async entferneVerbindung(id) {
        await beiKonflikt(entferneSkizzenVerbindung(einsatzId, id));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          verbindungen: alt.verbindungen.filter((v) => v.id !== id),
        }));
      },

      async legeKomponenteAn(art, bezeichnung) {
        const k = await legeKomponenteAn(einsatzId, {
          art,
          ...(bezeichnung != null ? { bezeichnung } : {}),
        });
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          komponenten: ersetze(alt.komponenten, k),
        }));
        return k;
      },
      async aendereKomponente(id, felder) {
        const k = await beiKonflikt(aendereKomponente(einsatzId, id, felder));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          komponenten: ersetze(alt.komponenten, k),
        }));
        return k;
      },
      async entferneKomponente(id) {
        await beiKonflikt(entferneKomponente(einsatzId, id));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          komponenten: alt.komponenten.filter((k) => k.id !== id),
        }));
        // Der Server räumt Kanäle, Lage und Verbindungen mit (D3): den Rest holt der Abruf.
        await holeSkizze();
      },

      async legeExterneStelleAn(stellenart, bezeichnung) {
        const planKey = einsatzKeys.stabKommunikationsplan(einsatzId);
        const vorher = new Set(
          (qc.getQueryData<KommunikationsStelle[]>(planKey) ?? []).map((s) => s.id),
        );
        const plan = await legeKommunikationsStelleAn(einsatzId, { stellenart, bezeichnung });
        qc.setQueryData(planKey, plan);
        // Die Antwort ist der ganze Plan: neu ist, was vorher nicht da war; ohne bekannten
        // Vorstand die jüngste Stelle dieser Art und Bezeichnung.
        const neu =
          plan.find((s) => !vorher.has(s.id) && s.stellenart === stellenart) ??
          plan
            .filter((s) => s.stellenart === stellenart && s.bezeichnung === bezeichnung)
            .sort((a, b) => b.id - a.id)[0];
        if (!neu) throw new Error('Die angelegte Stelle fehlt in der Antwort des Servers');
        return neu;
      },

      async legeBereichAn(felder) {
        const b = await legeBereichAn(einsatzId, felder);
        aendereSkizze(qc, einsatzId, (alt) => ({ ...alt, bereiche: ersetze(alt.bereiche, b) }));
        return b;
      },
      async aendereBereich(id, felder, version) {
        const b = await beiKonflikt(aendereBereich(einsatzId, id, { ...felder, version }));
        aendereSkizze(qc, einsatzId, (alt) => ({ ...alt, bereiche: ersetze(alt.bereiche, b) }));
        return b;
      },
      async entferneBereich(id) {
        await beiKonflikt(entferneBereich(einsatzId, id));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          bereiche: alt.bereiche.filter((b) => b.id !== id),
        }));
      },

      async setzeSchriftfeld(felder) {
        const schriftfeld = await setzeSchriftfeld(einsatzId, felder);
        aendereSkizze(qc, einsatzId, (alt) => ({ ...alt, schriftfeld }));
        return schriftfeld;
      },

      setzeRufname: (stelle, rufname) => feldDesDatensatzes(stelle, 'rufname', rufname),
      setzeKommunikationsmittel: (stelle, mittel) =>
        feldDesDatensatzes(stelle, 'kommunikationsmittel', mittel),
    };
  }, [qc, einsatzId]);
  return darfSchreiben ? aktionen : null;
}
