import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeFuehrungsstelle } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { ladeFernmeldeskizze } from '../api/fernmeldeskizze';
import { ladeKommunikationsplan } from '../api/kommunikationsplan';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import { ladeStab } from '../api/stab';
import type { EinsatzFahrzeug, ModulFreigaben, Stabsfunktion } from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import type { FuehrungsstelleQuelle } from './fuehrungsstelle';
import type { KanalQuellen, Quelle, SkizzenQuelle } from './luecken';
import type { StabFreigabe } from './useStabFreigabe';

/**
 * Eine Liste als Quelle des Funkplans, identitätsstabil je Daten und Zustand. Ein Fehler MIT
 * Daten ist ein Stand, kein Ausfall (der Datenstand im Kopf zeigt sein Alter). Ohne Freigabe ihres
 * Moduls (`frei: false`) ist sie `gesperrt` wie bei einem 403 und trägt keine Daten, auch keinen
 * Altstand aus dem Cache (LFH-669).
 */
export function useQuelle<T>(
  q: {
    data: T[] | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  },
  frei = true,
  ohneVerbindung = false,
): Quelle<T> {
  // `ohneVerbindung`: ein ohne Netz pausierter Abruf ohne Stand ist „nicht geladen“, nicht „lädt“.
  const zustand: AbrufZustand = !frei
    ? 'gesperrt'
    : q.data != null
      ? 'daten'
      : ohneVerbindung
        ? 'fehler'
        : abrufZustand(q);
  const data = frei ? q.data : undefined;
  return useMemo(() => ({ zustand, daten: data ?? [] }), [zustand, data]);
}

/** Die eigene Führungsstelle als Quelle (LFH-849), mit derselben Weiche wie die Listen. */
function useFuehrungsstelleQuelle(q: {
  data: FuehrungsstelleQuelle['daten'] | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
}): FuehrungsstelleQuelle {
  const zustand: AbrufZustand = q.data != null ? 'daten' : abrufZustand(q);
  const data = q.data ?? null;
  return useMemo(() => ({ zustand, daten: data }), [zustand, data]);
}

/** Die Quelle „Daten der Skizze“: wie eine Liste, aber eine Angabe (`stab/luecken.ts`). */
function useSkizzenQuelle(
  q: {
    data: SkizzenQuelle['daten'] | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  },
  frei: boolean,
  ohneVerbindung: boolean,
): SkizzenQuelle {
  // Ohne Netz pausiert der Abruf und stünde für immer „lädt“: die Skizze ist nicht offline
  // (`LAGEBILD_OFFLINE`), also „nicht geladen“ — wie auf dem Kommunikationsplan.
  const zustand: AbrufZustand = !frei
    ? 'gesperrt'
    : q.data != null
      ? 'daten'
      : ohneVerbindung
        ? 'fehler'
        : abrufZustand(q);
  const data = frei ? (q.data ?? null) : null;
  return useMemo(() => ({ zustand, daten: data }), [zustand, data]);
}

export interface NetzQuellen extends KanalQuellen {
  /** Disponierte Fahrzeuge: die Führungsfahrzeuge stehen im Kasten (LFH-1029). */
  fahrzeuge: Quelle<EinsatzFahrzeug>;
  /** Stab-Besetzung: die besetzten Sachgebiete im Kasten der Einsatzleitung (LFH-1029). */
  besetzung: Quelle<Stabsfunktion>;
  /** Die Modul-Freigaben, solange der Stab frei ist. */
  freigaben: ModulFreigaben | undefined;
  /** Cache-Zeitstempel der gezeigten Quellen, für `gemeinsamerDatenstand`. */
  zeitstempel: readonly (number | undefined)[];
}

/**
 * Die Quellen des Fernmeldenetzes (LFH-893): Abschnitte, Einheiten, Fahrzeuge, Sprechgruppen,
 * eigene Führungsstelle, Stab-Besetzung, Stellen des Kommunikationsplans und Daten der Skizze,
 * jede mit eigener Weiche.
 * Der Funkplan liest sie für Tabelle, Skizze und Sprechgruppen, Lagebericht und Befehl für die
 * Skizze als Anlage (LFH-1028). Die Sperre des Stabs gilt für alle: eine Liste läuft erst, wenn
 * der Stab frei ist UND der Server ihr Modul freigibt (LFH-669, Keys nach `PFAD_KEY`).
 */
export function useNetzQuellen(
  einsatzId: number,
  stabFreigabe: StabFreigabe,
  ohneVerbindung: boolean,
): NetzQuellen {
  const stabFrei = stabFreigabe.zustand === 'frei';
  const freigaben = stabFrei ? stabFreigabe.freigaben : undefined;
  const frei = (key: string) => stabFrei && istKeyFreigegeben(key, stabFreigabe.freigaben);
  const abschnitteFrei = frei('einsatzabschnitte');
  const einheitenFrei = frei('einheiten');
  const fahrzeugeFrei = frei('fahrzeuge');
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteFrei,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei,
  });
  // Nicht live (`NICHT_LIVE_KEYS`): eine fremd angelegte lokale Sprechgruppe erscheint erst beim
  // nächsten Abruf. Die Zuordnungen selbst kommen live über Abschnitte und Einheiten (D10).
  const sprechgruppenQuery = useQuery({
    queryKey: einsatzKeys.sprechgruppen(einsatzId),
    queryFn: () => listeEinsatzSprechgruppen(einsatzId),
  });
  // Die eigene Führungsstelle (LFH-849): Teil der Kopfdaten, kein Modul; live über `einsatz`.
  const fuehrungsstelleQuery = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  // LFH-893: die Stellen des Kommunikationsplans (offline lesbar) und die Daten der Skizze (nicht
  // offline), beide am Stab, live über `stab`.
  const stellenQuery = useQuery({
    queryKey: einsatzKeys.stabKommunikationsplan(einsatzId),
    queryFn: () => ladeKommunikationsplan(einsatzId),
    enabled: stabFrei,
  });
  const skizzeQuery = useQuery({
    queryKey: einsatzKeys.stabFernmeldeskizze(einsatzId),
    queryFn: () => ladeFernmeldeskizze(einsatzId),
    enabled: stabFrei,
  });
  // LFH-1029: die Stab-Besetzung für die Sachgebiete im Kasten der Einsatzleitung, live über `stab`.
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
    enabled: stabFrei,
    select: (stab) => stab.besetzung,
  });

  const abschnitte = useQuelle(abschnitteQuery, abschnitteFrei);
  const einheiten = useQuelle(einheitenQuery, einheitenFrei);
  const fahrzeuge = useQuelle(fahrzeugeQuery, fahrzeugeFrei);
  const sprechgruppen = useQuelle(sprechgruppenQuery);
  const fuehrungsstelle = useFuehrungsstelleQuelle(fuehrungsstelleQuery);
  const stellen = useQuelle(stellenQuery, stabFrei, ohneVerbindung);
  const skizze = useSkizzenQuelle(skizzeQuery, stabFrei, ohneVerbindung);
  const besetzung = useQuelle(stabQuery, stabFrei, ohneVerbindung);

  return {
    abschnitte,
    einheiten,
    fahrzeuge,
    besetzung,
    sprechgruppen,
    fuehrungsstelle,
    stellen,
    skizze,
    freigaben,
    // Ein gesperrtes Modul zählt nicht zum Stand: sein Cache-Zeitstempel gehört zu nichts Gezeigtem.
    zeitstempel: [
      abschnitteFrei ? abschnitteQuery.dataUpdatedAt : undefined,
      einheitenFrei ? einheitenQuery.dataUpdatedAt : undefined,
      fahrzeugeFrei ? fahrzeugeQuery.dataUpdatedAt : undefined,
      sprechgruppenQuery.dataUpdatedAt,
      fuehrungsstelleQuery.dataUpdatedAt,
      stellenQuery.dataUpdatedAt,
      skizzeQuery.dataUpdatedAt,
      stabQuery.dataUpdatedAt,
    ],
  };
}
