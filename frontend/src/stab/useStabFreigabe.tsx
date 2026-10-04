import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { SeitenFehler, SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import { freiesRueckwegModul, istKeyFreigegeben, modulZielRoute } from '../einsatz/modulRegistry';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Freigabe des Stab-Moduls für die Unterseiten des Stabs (Funkplan LFH-548, Pressearbeit und
 * Informationstelefon LFH-554). Diese Seiten sind keine eigenen Module; sie erben Sperre und
 * Sichtbarkeit vom Stab und müssen sie deshalb selbst ermitteln, bevor sie Daten zeigen. Die
 * Freigabe rechnet der Server (`GET …/modul-freigaben`, LFH-669); `frei` reicht die Freigaben
 * weiter, damit die Seite weitere Module (Lageberichte, Personen) ohne zweiten Abruf prüft.
 *
 * **Fail-closed:** Solange die Freigabe nicht ermittelt ist, gilt `laden`; scheitert der Abruf,
 * gilt `fehler`. Beide zeigen keine Daten (Review LFH-548).
 */
export type StabFreigabe =
  | { zustand: 'laden' }
  | { zustand: 'fehler'; fehler: unknown; wiederholen: () => void }
  | { zustand: 'gesperrt'; freigaben: ModulFreigaben }
  | { zustand: 'frei'; freigaben: ModulFreigaben };

export function useStabFreigabe(einsatzId: number): StabFreigabe {
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
  if (!istKeyFreigegeben('stab', freigaben)) return { zustand: 'gesperrt', freigaben };
  return { zustand: 'frei', freigaben };
}

/** Wie die Seite heißt: als Titel („Funkplan“) und mit Artikel im Satz („der Funkplan“). */
export interface StabUnterseite {
  titel: string;
  mitArtikel: string;
}

/**
 * Was eine Stab-Unterseite zeigt, solange die Freigabe nicht `frei` ist. Liefert `null` bei
 * `frei` — dann rendert die Seite selbst.
 */
export function stabFreigabeAnzeige(
  freigabe: StabFreigabe,
  seite: StabUnterseite,
  einsatzId: number,
): ReactNode {
  switch (freigabe.zustand) {
    case 'frei':
      return null;
    case 'laden':
      return <SeitenSkeleton />;
    case 'fehler':
      return (
        <SeitenFehler
          text={`Freigabe des Stabs nicht ermittelbar — ${seite.mitArtikel} bleibt verborgen`}
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
          hinweis={`Das Modul Stab ist in diesem Einsatz nicht freigegeben; ${seite.mitArtikel} gehört dazu.`}
          rueckweg={{
            pfad: einsatzModulPfad(einsatzId, modulZielRoute(ziel)),
            label: `${ziel.label} öffnen`,
          }}
        />
      );
    }
  }
}
