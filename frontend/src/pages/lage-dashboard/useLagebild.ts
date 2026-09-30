import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { abrufZustand, type AbrufZustand } from '../../api/abrufZustand';
import { ladeEinsatz } from '../../api/einsaetze';
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
 * Die Quellen des Lagebilds — EINE Zusammenstellung für Lage-Dashboard und die Vorbereitung der
 * Lagebesprechung (LFH-550). Beide bauen daraus mit `baueLagebild` dasselbe Lagebild; gleiche
 * Zahlen sind damit durch Konstruktion gesichert, nicht durch einen Vergleich.
 *
 * Aufträge und Meldungen lädt der Hook NICHT als Listen: ihre Mengen kommen aus dem Modulzähler
 * (`zaehler`, gleicher Cache wie das Modulpanel), siehe `fuehrungsZahlen.ts`.
 *
 * `basis` ist `null`, solange der Einsatz fehlt. Fehlende oder gesperrte Listen gehen als `[]`
 * hinein; ob eine Zahl daraus gilt, sagt `zustand` je Quelle — nie die Zahl selbst.
 */
export function useLagebild(einsatzId: number, { mitPegel }: Optionen) {
  const einsatz = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personen = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const uhs = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  const schaeden = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });
  const gefahren = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });
  const lageberichte = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });
  const einheiten = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personal = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeuge = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const material = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitte = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const pegel = useQuery({ ...pegelAbfrage(einsatzId), enabled: mitPegel });
  const zaehler = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });

  const basis = useMemo((): Lagebasis | null => {
    if (!einsatz.data) return null;
    return {
      einsatz: einsatz.data,
      personen: personen.data ?? [],
      uhs: uhs.data ?? [],
      schaeden: schaeden.data ?? [],
      gefahren: gefahren.data ?? [],
      lageberichte: lageberichte.data ?? [],
      einheiten: einheiten.data ?? [],
      personal: personal.data ?? [],
      fahrzeuge: fahrzeuge.data ?? [],
      material: material.data ?? [],
      abschnitte: abschnitte.data ?? [],
      pegel: pegel.data ?? [],
    };
  }, [
    einsatz.data,
    personen.data,
    uhs.data,
    schaeden.data,
    gefahren.data,
    lageberichte.data,
    einheiten.data,
    personal.data,
    fahrzeuge.data,
    material.data,
    abschnitte.data,
    pegel.data,
  ]);

  const q = {
    einsatz,
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
    pegel,
    zaehler,
  };

  /** Abrufzustand je Quelle (`gesperrt` = 403), für die Rechteweiche der Vorbereitung. */
  const zustand: Record<keyof typeof q, AbrufZustand> = {
    einsatz: abrufZustand(einsatz),
    personen: abrufZustand(personen),
    uhs: abrufZustand(uhs),
    schaeden: abrufZustand(schaeden),
    gefahren: abrufZustand(gefahren),
    lageberichte: abrufZustand(lageberichte),
    einheiten: abrufZustand(einheiten),
    personal: abrufZustand(personal),
    fahrzeuge: abrufZustand(fahrzeuge),
    material: abrufZustand(material),
    abschnitte: abrufZustand(abschnitte),
    pegel: abrufZustand(pegel),
    zaehler: abrufZustand(zaehler),
  };

  return { q, zustand, basis };
}

/** Stand eines Ausschnitts: der älteste geladene Teil (`gemeinsamerDatenstand`). */
export function standDer(...abfragen: Array<{ dataUpdatedAt: number }>): number {
  return gemeinsamerDatenstand(...abfragen.map((a) => a.dataUpdatedAt));
}
