import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { SeitenFehler, SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import { einsatzModulPfad } from '../routing/deeplinks';
import { freiesRueckwegModul, istKeyFreigegeben, modulName, modulZielRoute } from './modulRegistry';

/**
 * Freigabe eines Moduls für eine Seite, deren Quellen das Modul nicht selbst prüfen: die
 * Unterseiten des Stabs (Pressearbeit, Informationstelefon, LFH-554) und die Seiten des
 * Fernmeldewesens (Funkplan, Kommunikationsplan, LLH-1180, design.md D6), deren Listen an anderen
 * Modulen hängen. Die Freigabe rechnet der Server (`GET …/modul-freigaben`, LFH-669); `frei`
 * reicht die Freigaben weiter, damit die Seite weitere Module (Lageberichte, Personen, Stab) ohne
 * zweiten Abruf prüft.
 *
 * **Fail-closed:** Solange die Freigabe nicht ermittelt ist, gilt `laden`; scheitert der Abruf,
 * gilt `fehler`. Beide zeigen keine Daten (Review LFH-548). Der Einsatzrahmen allein reicht
 * nicht: Er rendert die Seite bei gescheitertem Abruf unverändert (Spec `modul-freigabe`).
 */
export type ModulFreigabe =
  | { zustand: 'laden' }
  | { zustand: 'fehler'; fehler: unknown; wiederholen: () => void }
  | { zustand: 'gesperrt'; freigaben: ModulFreigaben }
  | { zustand: 'frei'; freigaben: ModulFreigaben };

export function useModulFreigabe(einsatzId: number, key: string): ModulFreigabe {
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  if (freigaben == null) {
    if (freigabenQuery.isError) {
      return {
        zustand: 'fehler',
        fehler: freigabenQuery.error,
        wiederholen: () => void freigabenQuery.refetch(),
      };
    }
    return { zustand: 'laden' };
  }
  if (!istKeyFreigegeben(key, freigaben)) return { zustand: 'gesperrt', freigaben };
  return { zustand: 'frei', freigaben };
}

/** Wie die Seite heißt: als Titel („Funkplan“) und mit Artikel im Satz („der Funkplan“). */
export interface ModulSeite {
  titel: string;
  mitArtikel: string;
}

/**
 * Was die Seite zeigt, solange die Freigabe von `key` nicht `frei` ist. Liefert `null` bei
 * `frei` — dann rendert die Seite selbst.
 */
export function modulFreigabeAnzeige(
  freigabe: ModulFreigabe,
  key: string,
  seite: ModulSeite,
  einsatzId: number,
): ReactNode {
  const name = modulName(key);
  switch (freigabe.zustand) {
    case 'frei':
      return null;
    case 'laden':
      return <SeitenSkeleton />;
    case 'fehler':
      return (
        <SeitenFehler
          text={`Freigabe des Moduls ${name} nicht ermittelbar — ${seite.mitArtikel} bleibt verborgen`}
          ursache={freigabe.fehler}
          onWiederholen={freigabe.wiederholen}
        />
      );
    case 'gesperrt': {
      // Rückweg in ein freies Modul (LFH-888, design.md D3): fest der Überblick führte in eine
      // zweite Sackgasse, wenn auch er gesperrt ist.
      const ziel = freiesRueckwegModul(freigabe.freigaben);
      return (
        <SeitenSackgasse
          titel={`${seite.titel} nicht verfügbar`}
          hinweis={`Modul ${name} nicht freigegeben`}
          rueckweg={{
            pfad: einsatzModulPfad(einsatzId, modulZielRoute(ziel)),
            label: `${ziel.label} öffnen`,
          }}
        />
      );
    }
  }
}
