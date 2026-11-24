import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { ApiError } from '../api/client';
import { ladeFuehrungsstelle, patcheFuehrungsstelle } from '../api/incidents';
import { listeEinheiten, patcheEinheit } from '../api/einheiten';
import { listeAbschnitte, patcheAbschnitt } from '../api/einsatzabschnitte';
import {
  aendereBereich,
  aendereKomponente,
  aendereSkizzenVerbindung,
  entferneBereich,
  entferneKomponente,
  entferneSkizzenLage,
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
import {
  entferneKommunikationsStelle,
  legeKommunikationsStelleEinzelnAn,
} from '../api/kommunikationsplan';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Einsatzabschnitt,
  Fernmeldeskizze,
  KommunikationsStelle,
  ModulFreigaben,
  SkizzenLage,
} from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import {
  darfEinsatzVerwalten,
  darfImEinsatzSchreiben,
  type BenutzerOrgKontext,
  type EinsatzOrgKontext,
} from '../einsatz/schreibrecht';
import { useFeldKonflikt } from '../components/useFeldKonflikt';
import type { NetzRechte } from './fernmeldeskizze';
import { HandlungVerfallen, type SkizzenAktionen } from './skizzenAktionen';

/**
 * Die Schreibwege der Fernmeldeskizze (LFH-893, `fernmeldewesen/skizzenAktionen.ts`) gegen das API
 * (`api/fernmeldeskizze.ts`, design.md D5, D14).
 *
 * - **Cache wie beim Kommunikationsplan:** Antworten mit Datensatz (Lage, Komponente, Verbindung,
 *   Bereich, Schriftfeld, Führungsstelle, Plan) setzt der Hook per `setQueryData`; Antworten ohne
 *   Körper (Zuordnungen, Entfernen) invalidieren die Liste des Datensatzes. Das Live-Ereignis des
 *   Servers (`abschnitt`, `einheit`, `einsatz`, `fernmeldewesen`) erreicht dieselben Keys in jedem
 *   anderen Tab; die Skizzendaten hängen unter dem Prefix des Fernmeldewesens (LLH-1180).
 * - **Zuordnung am Datensatz** (D5): `ab-`, `eh-`, `fs`, `ks-`, `ko-` am Pfad des Datensatzes;
 *   der Rufname über dessen PATCH (Abschnitt `rufname`, LLH-1134; Einheit `funkrufname`,
 *   Führungsstelle `rufname`), je nur das eine Feld, mit dem Rufnamen zu Beginn der Handlung als
 *   `erwartet` (Feld-CAS, LLH-1945) und der Rückfrage aus `useFeldKonflikt`.
 * - **409** (abweichende Version): der Hook holt den Stand des Servers und reicht den Fehler
 *   weiter; die Fläche meldet ihn am Element (`befehlsGrund`).
 * - **Ohne Schreibrecht im Einsatz** gibt es keine Aktionen (`null`, D8): die Fläche ist dann
 *   schreibgeschützt. Das Recht je Element liest das Netz aus {@link skizzenRechte}.
 */

/** Das Recht je Quelle (D5, D8): Schreibrecht im Einsatz und, wo es eins gibt, das Modul frei. */
export function skizzenRechte(
  einsatz: EinsatzOrgKontext,
  benutzer: BenutzerOrgKontext,
  freigaben: ModulFreigaben | undefined,
): NetzRechte {
  const schreiben = darfImEinsatzSchreiben(einsatz);
  const frei = (key: string) => schreiben && istKeyFreigegeben(key, freigaben);
  return {
    einsatzabschnitte: frei('einsatzabschnitte'),
    einheiten: frei('einheiten'),
    // `EinsatzVerwaltungszugriff`: Schreibrecht oder Admin der Einsatz-Org im aktiven Einsatz, kein
    // Modul (LFH-1066).
    verwaltung: darfEinsatzVerwalten(einsatz, benutzer),
    // Das Skizzeneigene und die externen Stellen gehören dem Fernmeldewesen (LLH-1180).
    fernmeldewesen: frei('fernmeldewesen'),
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
  qc.setQueryData<Fernmeldeskizze>(einsatzKeys.fernmeldewesenSkizze(einsatzId), (alt) =>
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
  // Die Rückfrage braucht den App-Kontext; über die Ref bleiben die Aktionen dasselbe Objekt.
  const konflikt = useFeldKonflikt();
  const konfliktRef = useRef(konflikt);
  konfliktRef.current = konflikt;
  const aktionen = useMemo<SkizzenAktionen>(() => {
    const skizzeKey = einsatzKeys.fernmeldewesenSkizze(einsatzId);
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
            qc.invalidateQueries({
              queryKey: einsatzKeys.fernmeldewesenKommunikationsplan(einsatzId),
            }),
            holeSkizze(),
          ]);
        case 'komponente':
          return holeSkizze();
      }
    };
    /** Der gespeicherte Rufname im frisch geladenen Datensatz; `undefined` = es gibt ihn nicht mehr. */
    const loadRufnameFrisch = async (ziel: ZuordnungsZiel): Promise<string | null | undefined> => {
      switch (ziel.art) {
        case 'abschnitt': {
          const liste = await qc.fetchQuery({
            queryKey: einsatzKeys.abschnitte(einsatzId),
            queryFn: () => listeAbschnitte(einsatzId),
            staleTime: 0,
          });
          const a = liste.find((x) => x.id === ziel.id);
          return a && (a.rufname?.trim() || null);
        }
        case 'einheit': {
          const liste = await qc.fetchQuery({
            queryKey: einsatzKeys.einheiten(einsatzId),
            queryFn: () => listeEinheiten(einsatzId),
            staleTime: 0,
          });
          const e = liste.find((x) => x.id === ziel.id);
          return e && (e.funkrufname?.trim() || null);
        }
        default: {
          const fs = await qc.fetchQuery({
            queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
            queryFn: () => ladeFuehrungsstelle(einsatzId),
            staleTime: 0,
          });
          return fs.rufname?.trim() || null;
        }
      }
    };
    /**
     * Die Stelle eines Abschnitts zeigt ohne eigenen Rufnamen seine Kurzbezeichnung
     * (`funkplan.ts`). Das ist kein gespeicherter Rufname: als Altwert gilt dann „leer“.
     */
    const gespeicherterAltwert = (ziel: ZuordnungsZiel, angezeigt: string | null) => {
      if (ziel.art !== 'abschnitt' || angezeigt == null) return angezeigt;
      const a = qc
        .getQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId))
        ?.find((x) => x.id === ziel.id);
      return a && !a.rufname?.trim() && a.kurzbezeichnung === angezeigt ? null : angezeigt;
    };
    const rufnameDesDatensatzes = async (
      stelle: string,
      wert: string | null,
      angezeigt: string | null,
    ): Promise<string | null> => {
      const ziel = zielAus(stelle);
      if (ziel.art === 'stelle' || ziel.art === 'komponente') {
        // Externe Stellen und Komponenten tragen keinen Rufname.
        throw new Error(`„${stelle}“ trägt kein Feld rufname`);
      }
      const vorher = gespeicherterAltwert(ziel, angezeigt);
      const save = async (erwartet: string | null | undefined) => {
        switch (ziel.art) {
          case 'abschnitt':
            await patcheAbschnitt(
              einsatzId,
              ziel.id,
              { rufname: wert },
              erwartet === undefined ? undefined : { rufname: erwartet },
            );
            await holeDatensatz(ziel);
            return;
          case 'einheit':
            await patcheEinheit(
              einsatzId,
              ziel.id,
              { funkrufname: wert },
              erwartet === undefined ? undefined : { funkrufname: erwartet },
            );
            await holeDatensatz(ziel);
            return;
          case 'fuehrungsstelle': {
            const fs = await patcheFuehrungsstelle(
              einsatzId,
              { rufname: wert },
              erwartet === undefined ? undefined : { rufname: erwartet },
            );
            qc.setQueryData(einsatzKeys.fuehrungsstelle(einsatzId), fs);
            return;
          }
        }
      };
      const ergebnis = await konfliktRef.current({
        etikett: 'Rufname',
        erwartet: vorher,
        speichern: save,
        ladeFrisch: () => loadRufnameFrisch(ziel),
        aktuell: (frisch) => (frisch === undefined ? undefined : { wert: frisch }),
        text: (w) => w ?? '',
        leer: (w) => w == null,
      });
      if (ergebnis !== undefined) throw new HandlungVerfallen(ergebnis);
      return vorher;
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
      async entferneLage(element, version) {
        await beiKonflikt(entferneSkizzenLage(einsatzId, element, version));
        aendereSkizze(qc, einsatzId, (alt) => ({
          ...alt,
          lage: alt.lage.filter((l) => l.element !== element),
        }));
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
        // Die Antwort nennt genau die neue Stelle (`?antwort=stelle`, Review S4): „neu“ wird nicht
        // aus dem Cache des Plans erraten, der leer oder veraltet sein kann.
        const neu = await legeKommunikationsStelleEinzelnAn(einsatzId, { stellenart, bezeichnung });
        await qc.invalidateQueries({
          queryKey: einsatzKeys.fernmeldewesenKommunikationsplan(einsatzId),
        });
        return neu;
      },
      async entferneExterneStelle(id) {
        const plan = await beiKonflikt(entferneKommunikationsStelle(einsatzId, id));
        qc.setQueryData<KommunikationsStelle[]>(
          einsatzKeys.fernmeldewesenKommunikationsplan(einsatzId),
          plan,
        );
        // Der Server räumt Lage und Verbindungen der Stelle mit (D3): den Rest holt der Abruf.
        await holeSkizze();
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

      setzeRufname: (stelle, rufname, erwartet) => rufnameDesDatensatzes(stelle, rufname, erwartet),
    };
  }, [qc, einsatzId]);
  return darfSchreiben ? aktionen : null;
}
