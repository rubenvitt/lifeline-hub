/**
 * Die Alarmzeile „Was brennt“ für Überblick und Lagebild (LLH-1743, design.md D1): EIN Hook, damit
 * beide Seiten zur selben Minute dieselbe Zeile zeigen. Er lädt seine Quellen über dieselben
 * Query-Keys wie die Seiten (kein Doppelabruf) und fragt eine gesperrte Liste gar nicht erst ab
 * (`zustandNachFreigabe`, Spec `modul-freigabe`). Das Urteil über Fristen fällt gegen die Uhr
 * der Seite (`jetzt`), damit eine Rückmeldung auch ohne neue Daten überfällig wird.
 */
import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useMemo } from 'react';
import {
  abrufZustand,
  schlechtesterZustand,
  zustandNachFreigabe,
  type AbrufZustand,
} from '../api/abrufZustand';
import { ladeModulFreigaben } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listEinsatzMaterial } from '../api/einsatzMaterial';
import { listePersonen } from '../api/einsatzPerson';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { holeRueckmeldungen } from '../api/meldungen';
import { ladeModulZaehler } from '../api/modulZaehler';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { freigabeVon } from '../einsatz/modulRegistry';
import { rueckmeldungUeberfaelligSeit, rueckmeldungZustand } from '../meldungen/rueckmeldung';
import { verdichtePersonen } from '../pages/lage-dashboard/lageVerdichtung';
import {
  auftragsStand,
  erinnerungsStand,
  meldungsStand,
  nachforderungsStand,
  type Zaehlstand,
} from '../pages/lage-dashboard/fuehrungsZahlen';
import { einheitenMitAusfall } from './ausfallJeEinheit';
import { wasBrennt, type QuellStand, type WasBrennt, type WasBrenntQuellen } from './wasBrennt';

function ausZaehler<T, W>(s: Zaehlstand<T>, wert: (t: T) => W): QuellStand<W> {
  return s.zustand === 'daten' ? { zustand: 'daten', wert: wert(s.zahl) } : { zustand: s.zustand };
}

function ausListe<T, W>(
  zustand: AbrufZustand,
  daten: T | undefined,
  wert: (t: T) => W,
): QuellStand<W> {
  if (zustand !== 'daten') return { zustand };
  return daten === undefined ? { zustand: 'laden' } : { zustand: 'daten', wert: wert(daten) };
}

/** Abruftakt des Modulzählers für die Alarmzeile. */
export const ZAEHLER_TAKT_MS = 60_000;

export interface AlarmZeilenDaten extends WasBrennt {
  /** Freigaben für die Sprungziele (`lage/alarmZiel.ts`). */
  freigaben: ModulFreigaben | undefined;
}

export function useWasBrennt(einsatzId: number, jetzt: Dayjs): AlarmZeilenDaten {
  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQ.data;
  const freigabenGescheitert = freigaben === undefined && freigabenQ.isError;
  const frei = (key: string) => freigabeVon(key, freigaben);

  // Überfällig urteilt der Server beim Abruf; für das Verstreichen einer Nachforderungsfrist gibt
  // es kein Live-Ereignis. Deshalb holt die Zeile den Zähler auch ohne neue Daten jede Minute
  // (Spec `lage-alarmzeile`, „Zeit läuft ohne neue Daten weiter“; Review LLH-1743).
  const zaehlerQ = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
    refetchInterval: ZAEHLER_TAKT_MS,
  });
  const personenFrei = frei('personen');
  const personenQ = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: personenFrei === true,
  });
  const abschnitteFrei = frei('einsatzabschnitte');
  const abschnitteQ = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteFrei === true,
  });
  const einheitenFrei = frei('einheiten');
  const einheitenQ = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei === true,
  });
  const personalFrei = frei('personal');
  const personalQ = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei === true,
  });
  const fahrzeugeFrei = frei('fahrzeuge');
  const fahrzeugeQ = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei === true,
  });
  const materialFrei = frei('material');
  const materialQ = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: materialFrei === true,
  });
  const rueckmeldungenFrei = frei('meldungen');
  const rueckmeldungenQ = useQuery({
    queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId),
    queryFn: () => holeRueckmeldungen(einsatzId),
    enabled: rueckmeldungenFrei === true,
  });

  const z = (q: Parameters<typeof abrufZustand>[0], f: boolean | undefined) =>
    zustandNachFreigabe(q, f, freigabenGescheitert);
  const personenZ = z(personenQ, personenFrei);
  const abschnitteZ = z(abschnitteQ, abschnitteFrei);
  const einheitenZ = z(einheitenQ, einheitenFrei);
  const personalZ = z(personalQ, personalFrei);
  const fahrzeugeZ = z(fahrzeugeQ, fahrzeugeFrei);
  const materialZ = z(materialQ, materialFrei);
  const rueckmeldungenZ = z(rueckmeldungenQ, rueckmeldungenFrei);

  // Ausfall wie im Meldebild (LLH-1743, Review): ohne Einheiten keine Aussage; eine gesperrte
  // Mittel-Liste zählt dort als leer (`?? []`), also auch hier, nie mit einem Altstand aus dem
  // Cache. Lädt oder scheitert eine Liste, hält die Quelle den Ausfall zurück, sonst wiche die Zahl
  // vom Meldebild ab.
  const mittelZ = [abschnitteZ, personalZ, fahrzeugeZ, materialZ];
  const ausfallZ: AbrufZustand =
    einheitenZ === 'gesperrt'
      ? 'gesperrt'
      : schlechtesterZustand(einheitenZ, ...mittelZ.filter((m) => m !== 'gesperrt'));
  const leerWennGesperrt = <T>(zustand: AbrufZustand, daten: T[] | undefined): T[] | undefined =>
    zustand === 'gesperrt' ? [] : daten;
  const ausfall = useMemo(() => {
    if (ausfallZ !== 'daten') return null;
    const einheiten = einheitenQ.data;
    const abschnitte = leerWennGesperrt(abschnitteZ, abschnitteQ.data);
    const personal = leerWennGesperrt(personalZ, personalQ.data);
    const fahrzeuge = leerWennGesperrt(fahrzeugeZ, fahrzeugeQ.data);
    const material = leerWennGesperrt(materialZ, materialQ.data);
    if (!einheiten || !abschnitte || !personal || !fahrzeuge || !material) return null;
    // Folge der Einheitenliste wie der Server für den Lagemonitor (LLH-1929).
    return einheitenMitAusfall({ abschnitte, einheiten, personal, fahrzeuge, material });
  }, [
    ausfallZ,
    abschnitteZ,
    personalZ,
    fahrzeugeZ,
    materialZ,
    einheitenQ.data,
    abschnitteQ.data,
    personalQ.data,
    fahrzeugeQ.data,
    materialQ.data,
  ]);

  const quellen: WasBrenntQuellen = {
    meldungen: ausZaehler(meldungsStand(zaehlerQ), (m) => m),
    auftraege: ausZaehler(auftragsStand(zaehlerQ), (a) => a),
    erinnerungen: ausZaehler(erinnerungsStand(zaehlerQ), (e) => e),
    nachforderungen: ausZaehler(nachforderungsStand(zaehlerQ), (n) => n),
    vermisst: ausListe(personenZ, personenQ.data, (p) => verdichtePersonen(p).vermisst),
    kritisch: ausListe(abschnitteZ, abschnitteQ.data, (abschnitte) =>
      [...abschnitte]
        .sort((a, b) => a.sortier - b.sortier || a.id - b.id)
        .filter((a) => a.lagezustand === 'kritisch')
        .map((a) => ({ id: a.id, name: a.name })),
    ),
    // Wie der Server (`meldung::rueckmeldung`) je Einheit, nur Einheiten des Einsatzes.
    rueckmeldung: ausListe(
      schlechtesterZustand(rueckmeldungenZ, einheitenZ),
      rueckmeldungenQ.data && einheitenQ.data
        ? { daten: rueckmeldungenQ.data, einheiten: einheitenQ.data }
        : undefined,
      ({ daten, einheiten }) => {
        const name = new Map(einheiten.map((e) => [e.id, e.name]));
        return daten.einheiten.flatMap((r) => {
          const n = name.get(r.bezug_id);
          if (n == null || rueckmeldungZustand(r, jetzt) !== 'ueberfaellig') return [];
          return [
            { id: r.bezug_id, name: n, seitMin: rueckmeldungUeberfaelligSeit(r, jetzt) ?? 0 },
          ];
        });
      },
    ),
    ausfall:
      ausfallZ === 'daten'
        ? ausfall
          ? { zustand: 'daten', wert: ausfall }
          : { zustand: 'laden' }
        : { zustand: ausfallZ },
  };
  return { ...wasBrennt(quellen, jetzt), freigaben };
}
