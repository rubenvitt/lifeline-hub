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
import { ausfallJeEinheit, OHNE_EINHEIT } from './ausfallJeEinheit';
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

  const zaehlerQ = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
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

  // Ausfall braucht alle Mittel: fehlt eine Liste, ist die Zahl nicht die des Meldebilds.
  const ausfallZ = schlechtesterZustand(einheitenZ, abschnitteZ, personalZ, fahrzeugeZ, materialZ);
  const ausfall = useMemo(() => {
    if (ausfallZ !== 'daten') return null;
    const { data: einheiten } = einheitenQ;
    const { data: abschnitte } = abschnitteQ;
    const { data: personal } = personalQ;
    const { data: fahrzeuge } = fahrzeugeQ;
    const { data: material } = materialQ;
    if (!einheiten || !abschnitte || !personal || !fahrzeuge || !material) return null;
    const je = ausfallJeEinheit({ abschnitte, einheiten, personal, fahrzeuge, material });
    return [...je.entries()]
      .filter(([, a]) => a.mittel + a.material > 0)
      .map(([schluessel, a]) => ({
        id: schluessel === OHNE_EINHEIT ? null : schluessel,
        name: a.bezeichnung,
      }));
  }, [ausfallZ, einheitenQ, abschnitteQ, personalQ, fahrzeugeQ, materialQ]);

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
