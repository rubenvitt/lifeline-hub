import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { abrufZustand, type AbrufZustand } from '../../api/abrufZustand';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listePersonen } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { listeUhs } from '../../api/einsatzUhs';
import { listeEinheiten } from '../../api/einheiten';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeLageberichte } from '../../api/lageberichte';
import { ladeModulZaehler } from '../../api/modulZaehler';
import { pegelAbfrage } from '../../api/pegel';
import { einsatzKeys } from '../../api/queryKeys';
import { gemeinsamerDatenstand } from '../../components/Datenstand';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { gesperrt, ladeListe, type Geladen } from '../../lageberichte/uebernahmeQuelle';
import type { ModulFreigaben } from '../../api/types';
import type { Rohdaten } from './lagebild';

/** Was jede Ansicht des Lagebilds gleich liefert; die Seitenteile (Pegel-Ziel, Evakuierung)
 *  entscheidet die Seite selbst. */
export type Lagebasis = Omit<Rohdaten, 'pegelZiel' | 'evakuierung' | 'evakuierungZiel'>;

interface Optionen {
  /** Maßgebliche Pegel mitladen (5-min-Nachfrage, kein Live-Ereignis). Nur das Dashboard braucht
   *  den Pegel-Platz; die Vorbereitung der Lagebesprechung lässt ihn weg. */
  mitPegel: boolean;
}

/** Eine modulgebundene Liste des Lagebilds: ihr Modul, ihr Key, ihr Abruf. */
function quelle<T>(
  modul: string,
  key: (einsatzId: number) => readonly unknown[],
  abruf: (einsatzId: number) => Promise<T[]>,
) {
  return { modul, key, abruf };
}

/**
 * Die modulgebundenen Quellen des Lagebilds mit Modul (Schlüssel nach `PFAD_KEY` in
 * `src/einsatz/modul.rs`; die Lageberichte prüfen ihr Modul im Handler), Key und Abruf. EINE
 * Beschreibung für den Hook (Dashboard, Vorbereitung) und den Abruf beim Klick
 * (`ladeLagebasis`, Übernahme in den Lagevortrag, LFH-869): gleiche Listen, gleiche Keys, gleicher
 * Cache.
 */
export const LAGEBILD_QUELLEN = {
  personen: quelle('personen', einsatzKeys.personen, (id) => listePersonen(id)),
  uhs: quelle('unfallhilfsstellen', einsatzKeys.uhs, listeUhs),
  schaeden: quelle('schaeden', einsatzKeys.schaeden, listeSchaeden),
  gefahren: quelle('gefahrenzonen', einsatzKeys.gefahrengebiete, ladeGefahrengebiete),
  lageberichte: quelle('lageberichte', einsatzKeys.lageberichte, listeLageberichte),
  einheiten: quelle('einheiten', einsatzKeys.einheiten, listeEinheiten),
  personal: quelle('personal', einsatzKeys.personal, listeEinsatzPersonal),
  fahrzeuge: quelle('fahrzeuge', einsatzKeys.fahrzeuge, listeEinsatzFahrzeuge),
  material: quelle('material', einsatzKeys.material, listeEinsatzMaterial),
  abschnitte: quelle('einsatzabschnitte', einsatzKeys.abschnitte, listeAbschnitte),
};

export type GebundeneQuelle = keyof typeof LAGEBILD_QUELLEN;

/** Ist die Liste für die Person frei? Ohne bekannte Freigaben nie. */
export function quelleFrei(quelle: GebundeneQuelle, freigaben: ModulFreigaben | undefined) {
  return istKeyFreigegeben(LAGEBILD_QUELLEN[quelle].modul, freigaben);
}

/**
 * Die Quellen des Lagebilds — EINE Zusammenstellung für Lage-Dashboard und die Vorbereitung der
 * Lagebesprechung (LFH-550). Beide bauen daraus mit `baueLagebild` dasselbe Lagebild; gleiche
 * Zahlen sind damit durch Konstruktion gesichert, nicht durch einen Vergleich.
 *
 * Aufträge und Meldungen lädt der Hook NICHT als Listen: ihre Mengen kommen aus dem Modulzähler
 * (`zaehler`, gleicher Cache wie das Modulpanel), siehe `fuehrungsZahlen.ts`.
 *
 * **Modulgrenze (LFH-669, Spec `modul-freigabe`):** eine Liste eines fremden Moduls wird nur
 * angefragt, wenn der Server das Modul freigibt — ohne bekannte Freigaben (Laden, Fehler) gar
 * nicht. Eine gesperrte Quelle liefert keine Daten, auch nicht aus dem Cache (`daten`), zählt
 * nicht in den Datenstand (`stand`) und steht in `zustand` als `gesperrt`, nie als Ausfall.
 * Fehlen die Freigaben selbst, stehen die gebundenen Quellen auf `fehler` (sonst sähe das
 * Lagebild ruhig aus), und `nachladen` fragt die Freigaben neu statt der gesperrten Liste.
 *
 * `basis` ist `null`, solange der Einsatz fehlt. Fehlende oder gesperrte Listen gehen als `[]`
 * hinein; ob eine Zahl daraus gilt, sagt `zustand` je Quelle — nie die Zahl selbst.
 */
export function useLagebild(einsatzId: number, { mitPegel }: Optionen) {
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  // Ausfall nur ohne verwertbaren Stand: scheitert ein Neuabruf, bleiben die alten Freigaben gültig.
  const freigabenFehler = freigabenQuery.isError && freigaben === undefined;
  const frei = (quelle: GebundeneQuelle) => quelleFrei(quelle, freigaben);

  const einsatz = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personen = useQuery({
    queryKey: LAGEBILD_QUELLEN.personen.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.personen.abruf(einsatzId),
    enabled: frei('personen'),
  });
  const uhs = useQuery({
    queryKey: LAGEBILD_QUELLEN.uhs.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.uhs.abruf(einsatzId),
    enabled: frei('uhs'),
  });
  const schaeden = useQuery({
    queryKey: LAGEBILD_QUELLEN.schaeden.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.schaeden.abruf(einsatzId),
    enabled: frei('schaeden'),
  });
  const gefahren = useQuery({
    queryKey: LAGEBILD_QUELLEN.gefahren.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.gefahren.abruf(einsatzId),
    enabled: frei('gefahren'),
  });
  const lageberichte = useQuery({
    queryKey: LAGEBILD_QUELLEN.lageberichte.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.lageberichte.abruf(einsatzId),
    enabled: frei('lageberichte'),
  });
  const einheiten = useQuery({
    queryKey: LAGEBILD_QUELLEN.einheiten.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.einheiten.abruf(einsatzId),
    enabled: frei('einheiten'),
  });
  const personal = useQuery({
    queryKey: LAGEBILD_QUELLEN.personal.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.personal.abruf(einsatzId),
    enabled: frei('personal'),
  });
  const fahrzeuge = useQuery({
    queryKey: LAGEBILD_QUELLEN.fahrzeuge.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.fahrzeuge.abruf(einsatzId),
    enabled: frei('fahrzeuge'),
  });
  const material = useQuery({
    queryKey: LAGEBILD_QUELLEN.material.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.material.abruf(einsatzId),
    enabled: frei('material'),
  });
  const abschnitte = useQuery({
    queryKey: LAGEBILD_QUELLEN.abschnitte.key(einsatzId),
    queryFn: () => LAGEBILD_QUELLEN.abschnitte.abruf(einsatzId),
    enabled: frei('abschnitte'),
  });
  const pegel = useQuery({ ...pegelAbfrage(einsatzId), enabled: mitPegel });
  const zaehler = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });

  const gebunden = {
    personen,
    uhs,
    schaeden,
    gefahren,
    lageberichte,
    einheiten,
    personal,
    fahrzeuge,
    material,
    abschnitte,
  };

  /** Die Rohdaten einer gebundenen Quelle — gesperrt `undefined`, auch mit Altstand im Cache. */
  const daten = {
    personen: frei('personen') ? personen.data : undefined,
    uhs: frei('uhs') ? uhs.data : undefined,
    schaeden: frei('schaeden') ? schaeden.data : undefined,
    gefahren: frei('gefahren') ? gefahren.data : undefined,
    lageberichte: frei('lageberichte') ? lageberichte.data : undefined,
    einheiten: frei('einheiten') ? einheiten.data : undefined,
    personal: frei('personal') ? personal.data : undefined,
    fahrzeuge: frei('fahrzeuge') ? fahrzeuge.data : undefined,
    material: frei('material') ? material.data : undefined,
    abschnitte: frei('abschnitte') ? abschnitte.data : undefined,
  };

  const basis = useMemo((): Lagebasis | null => {
    if (!einsatz.data) return null;
    return {
      einsatz: einsatz.data,
      personen: daten.personen ?? [],
      uhs: daten.uhs ?? [],
      schaeden: daten.schaeden ?? [],
      gefahren: daten.gefahren ?? [],
      lageberichte: daten.lageberichte ?? [],
      einheiten: daten.einheiten ?? [],
      personal: daten.personal ?? [],
      fahrzeuge: daten.fahrzeuge ?? [],
      material: daten.material ?? [],
      abschnitte: daten.abschnitte ?? [],
      pegel: pegel.data ?? [],
    };
  }, [
    einsatz.data,
    daten.personen,
    daten.uhs,
    daten.schaeden,
    daten.gefahren,
    daten.lageberichte,
    daten.einheiten,
    daten.personal,
    daten.fahrzeuge,
    daten.material,
    daten.abschnitte,
    pegel.data,
  ]);

  const q = { einsatz, ...gebunden, pegel, zaehler };

  /** Zustand einer gebundenen Quelle: frei wie ihr Abruf, sonst nach den Freigaben. */
  const gebundenerZustand = (quelle: GebundeneQuelle): AbrufZustand => {
    if (frei(quelle)) return abrufZustand(gebunden[quelle]);
    if (freigaben !== undefined) return 'gesperrt';
    return freigabenFehler ? 'fehler' : 'laden';
  };

  /** Abrufzustand je Quelle (`gesperrt` = nicht freigegeben oder 403), für die Rechteweichen. */
  const zustand: Record<keyof typeof q, AbrufZustand> = {
    einsatz: abrufZustand(einsatz),
    personen: gebundenerZustand('personen'),
    uhs: gebundenerZustand('uhs'),
    schaeden: gebundenerZustand('schaeden'),
    gefahren: gebundenerZustand('gefahren'),
    lageberichte: gebundenerZustand('lageberichte'),
    einheiten: gebundenerZustand('einheiten'),
    personal: gebundenerZustand('personal'),
    fahrzeuge: gebundenerZustand('fahrzeuge'),
    material: gebundenerZustand('material'),
    abschnitte: gebundenerZustand('abschnitte'),
    pegel: abrufZustand(pegel),
    zaehler: abrufZustand(zaehler),
  };

  /** Datenstand je Quelle; eine gesperrte zählt nicht (0 fällt aus `gemeinsamerDatenstand`). */
  const stand = (quelle: keyof typeof q): number =>
    quelle in LAGEBILD_QUELLEN && !frei(quelle as GebundeneQuelle) ? 0 : q[quelle].dataUpdatedAt;

  /**
   * „Erneut abrufen" einer gebundenen Quelle. Fehlen die Freigaben, werden sie neu gefragt — die
   * Liste selbst nie ohne Freigabe (`refetch` umginge `enabled`).
   */
  const nachladen = (quelle: GebundeneQuelle) => {
    if (frei(quelle)) void gebunden[quelle].refetch();
    else if (freigabenFehler) void freigabenQuery.refetch();
  };

  return { q, zustand, basis, daten, stand, nachladen };
}

/** Ergebnis von `ladeLagebasis`: Zustand nur für die geladenen Quellen. */
export interface GeladeneLagebasis {
  /** `null`, solange bzw. wenn der Einsatz fehlt. */
  basis: Lagebasis | null;
  zustand: Partial<Record<GebundeneQuelle | 'pegel', AbrufZustand>> & { einsatz: AbrufZustand };
  /** Ältester Abruf der gelesenen Listen (ms seit Epoche); `undefined`, wenn keine Daten kamen. */
  stand: number | undefined;
}

/**
 * Dieselbe Zusammenstellung wie `useLagebild`, aber beim Klick (`fetchQuery`, gemeinsamer Cache):
 * für die Übernahme in den Lagevortrag (LFH-869, design.md D1). Geladen werden nur `quellen`; eine
 * gesperrte wird nicht angefragt und steht als `gesperrt`, eine gescheiterte als `fehler`. Nicht
 * geladene Listen gehen wie im Hook als `[]` in die Basis — ob eine Zahl gilt, sagt `zustand`.
 */
export async function ladeLagebasis(
  qc: QueryClient,
  einsatzId: number,
  freigaben: ModulFreigaben,
  { quellen, mitPegel }: { quellen: readonly GebundeneQuelle[]; mitPegel: boolean },
): Promise<GeladeneLagebasis> {
  const lade = (q: GebundeneQuelle): Promise<Geladen<unknown[]>> =>
    quelleFrei(q, freigaben)
      ? ladeListe<unknown[]>(
          qc,
          LAGEBILD_QUELLEN[q].key(einsatzId),
          () => LAGEBILD_QUELLEN[q].abruf(einsatzId),
          [],
        )
      : Promise.resolve(gesperrt<unknown[]>([]));
  const pegelAbruf = pegelAbfrage(einsatzId);
  const [einsatz, pegel, ...listen] = await Promise.all([
    ladeListe(qc, einsatzKeys.einsatz(einsatzId), () => ladeEinsatz(einsatzId), null),
    mitPegel ? ladeListe(qc, pegelAbruf.queryKey, pegelAbruf.queryFn, []) : Promise.resolve(null),
    ...quellen.map(lade),
  ]);
  const geladen = new Map(quellen.map((q, i) => [q, listen[i]]));
  const daten = <Q extends GebundeneQuelle>(q: Q) =>
    (geladen.get(q)?.daten ?? []) as Awaited<ReturnType<(typeof LAGEBILD_QUELLEN)[Q]['abruf']>>;

  const zustand: GeladeneLagebasis['zustand'] = { einsatz: einsatz.zustand };
  for (const [q, g] of geladen) zustand[q] = g.zustand;
  if (pegel) zustand.pegel = pegel.zustand;

  const staende = [...geladen.values(), ...(pegel ? [pegel] : [])].map((g) => g.stand ?? 0);
  const stand = gemeinsamerDatenstand(...staende) || undefined;

  return {
    basis: einsatz.daten
      ? {
          einsatz: einsatz.daten,
          personen: daten('personen'),
          uhs: daten('uhs'),
          schaeden: daten('schaeden'),
          gefahren: daten('gefahren'),
          lageberichte: daten('lageberichte'),
          einheiten: daten('einheiten'),
          personal: daten('personal'),
          fahrzeuge: daten('fahrzeuge'),
          material: daten('material'),
          abschnitte: daten('abschnitte'),
          pegel: pegel?.daten ?? [],
        }
      : null,
    zustand,
    stand,
  };
}
