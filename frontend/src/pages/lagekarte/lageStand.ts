import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ladeEinsatz } from '../../api/incidents';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeFuehrungskraefte } from '../../api/einsatzPersonal';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { ladeBetreuung } from '../../api/betreuung';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  BetreuungUebersicht,
  Einheit,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  Einsatzabschnitt,
  FuehrungskraftKarte,
} from '../../api/types';

/**
 * Gespeicherter Stand eines Lageobjekts für den Feld-CAS der Lagewege (LLH-1945, Spec
 * `formularseiten`, „Einzelangabe prüft auf zwischenzeitliche Änderung“): Wege ohne offenes Feld
 * (Platzieren, Fläche zeichnen, Zeichen wählen) schicken als `erwartet` den Stand zu Beginn der
 * Handlung, gelesen aus dem Cache der Karte. Die Werte stehen in der Wire-Form des jeweiligen
 * PATCH (`…/position`, `…/flaeche`, Stelle, Kopf); `null` = leer.
 */
export type LageTyp =
  'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt' | 'betreuungsstelle' | 'einsatzort';
export type LageWerte = Partial<Record<LageFeld, string | number | null>>;
export type LageFeld =
  | 'lat'
  | 'lon'
  | 'tz_fachaufgabe'
  | 'tz_organisation'
  | 'flaeche_geojson'
  | 'einsatzort_lat'
  | 'einsatzort_lon';

interface Quelle<D> {
  key: (einsatzId: number) => QueryKey;
  load: (einsatzId: number) => Promise<D>;
  finde: (daten: D, id: number) => LageWerte | undefined;
}

const position = (x: {
  lat?: number | null;
  lon?: number | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
}): LageWerte => ({
  lat: x.lat ?? null,
  lon: x.lon ?? null,
  tz_fachaufgabe: x.tz_fachaufgabe ?? null,
  tz_organisation: x.tz_organisation ?? null,
});

/**
 * Bindet eine getypte Quelle in die Tabelle (die Daten bleiben je Quelle in sich stimmig). `load`
 * greift erst beim Aufruf auf die API zu, nicht beim Laden des Moduls.
 */
const quelle = <D>(q: Quelle<D>) => q as unknown as Quelle<unknown>;

const QUELLEN: Record<LageTyp, Quelle<unknown>> = {
  einheit: quelle<Einheit[]>({
    key: einsatzKeys.einheiten,
    load: (e) => listeEinheiten(e),
    finde: (liste: Einheit[], id) => {
      const x = liste.find((e) => e.id === id);
      return x && position(x);
    },
  }),
  fahrzeug: quelle<EinsatzFahrzeug[]>({
    key: einsatzKeys.fahrzeuge,
    load: (e) => listeEinsatzFahrzeuge(e),
    finde: (liste: EinsatzFahrzeug[], id) => {
      const x = liste.find((e) => e.id === id);
      return x && position(x);
    },
  }),
  fuehrung: quelle<FuehrungskraftKarte[]>({
    key: einsatzKeys.fuehrungskraefte,
    load: (e) => listeFuehrungskraefte(e),
    finde: (liste: FuehrungskraftKarte[], id) => {
      const x = liste.find((e) => e.id === id);
      return x && position(x);
    },
  }),
  abschnitt: quelle<Einsatzabschnitt[]>({
    key: einsatzKeys.abschnitte,
    load: (e) => listeAbschnitte(e),
    finde: (liste: Einsatzabschnitt[], id) => {
      const x = liste.find((e) => e.id === id);
      return (
        x && {
          flaeche_geojson: x.flaeche_geojson ?? null,
          tz_fachaufgabe: x.tz_fachaufgabe ?? null,
          tz_organisation: x.tz_organisation ?? null,
        }
      );
    },
  }),
  betreuungsstelle: quelle<BetreuungUebersicht>({
    key: einsatzKeys.betreuung,
    load: (e) => ladeBetreuung(e),
    finde: (u: BetreuungUebersicht, id) => {
      const x = u.stellen.find((s) => s.id === id);
      return x && { lat: x.lat ?? null, lon: x.lon ?? null };
    },
  }),
  einsatzort: quelle<EinsatzAnzeige>({
    key: einsatzKeys.einsatz,
    load: (e) => ladeEinsatz(e),
    finde: (e: EinsatzAnzeige) => ({
      einsatzort_lat: e.einsatzort_lat ?? null,
      einsatzort_lon: e.einsatzort_lon ?? null,
    }),
  }),
};

export function istLageTyp(typ: string): typ is LageTyp {
  return typ in QUELLEN;
}

/** Der Stand im Cache; `undefined`, solange die Quelle nicht geladen ist oder das Objekt fehlt. */
export function lageStandImCache(
  qc: QueryClient,
  einsatzId: number,
  typ: LageTyp,
  id: number,
): LageWerte | undefined {
  const q = QUELLEN[typ];
  const daten = qc.getQueryData(q.key(einsatzId));
  return daten === undefined ? undefined : q.finde(daten, id);
}

/** Lädt den Stand frisch am Cache vorbei und legt ihn dort ab (nach einem 409). */
export async function loadLageStand(
  qc: QueryClient,
  einsatzId: number,
  typ: LageTyp,
  id: number,
): Promise<LageWerte | undefined> {
  const q = QUELLEN[typ];
  const daten = await qc.fetchQuery({
    queryKey: q.key(einsatzId),
    queryFn: () => q.load(einsatzId),
    staleTime: 0,
  });
  return q.finde(daten, id);
}

/** Nur die genannten Felder eines Stands, in derselben Reihenfolge. */
export function lageAusschnitt(werte: LageWerte, felder: readonly LageFeld[]): LageWerte {
  return Object.fromEntries(felder.map((f) => [f, werte[f] ?? null]));
}
