import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import type { Rohdaten } from './lagebild';

/** Was jede Ansicht des Lagebilds gleich liefert; die Seitenteile (Pegel-Ziel, Evakuierung)
 *  entscheidet die Seite selbst. */
export type Lagebasis = Omit<Rohdaten, 'pegelZiel' | 'evakuierung' | 'evakuierungZiel'>;

interface Optionen {
  /** Maßgebliche Pegel mitladen (5-min-Nachfrage, kein Live-Ereignis). Nur das Dashboard braucht
   *  den Pegel-Platz; die Vorbereitung der Lagebesprechung lässt ihn weg. */
  mitPegel: boolean;
}

/**
 * Die modulgebundenen Quellen des Lagebilds und ihr Modul (Schlüssel nach `PFAD_KEY` in
 * `src/einsatz/modul.rs`; die Lageberichte prüfen ihr Modul im Handler).
 */
const QUELL_MODUL = {
  personen: 'personen',
  uhs: 'unfallhilfsstellen',
  schaeden: 'schaeden',
  gefahren: 'gefahrenzonen',
  lageberichte: 'lageberichte',
  einheiten: 'einheiten',
  personal: 'personal',
  fahrzeuge: 'fahrzeuge',
  material: 'material',
  abschnitte: 'einsatzabschnitte',
} as const;

export type GebundeneQuelle = keyof typeof QUELL_MODUL;

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
  const frei = (quelle: GebundeneQuelle) => istKeyFreigegeben(QUELL_MODUL[quelle], freigaben);

  const einsatz = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personen = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: frei('personen'),
  });
  const uhs = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: frei('uhs'),
  });
  const schaeden = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
    enabled: frei('schaeden'),
  });
  const gefahren = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
    enabled: frei('gefahren'),
  });
  const lageberichte = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
    enabled: frei('lageberichte'),
  });
  const einheiten = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: frei('einheiten'),
  });
  const personal = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: frei('personal'),
  });
  const fahrzeuge = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: frei('fahrzeuge'),
  });
  const material = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
    enabled: frei('material'),
  });
  const abschnitte = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
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
    quelle in QUELL_MODUL && !frei(quelle as GebundeneQuelle) ? 0 : q[quelle].dataUpdatedAt;

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
