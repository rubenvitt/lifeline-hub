import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulOverrides } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SeitenFehler, SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Freigabe des Stab-Moduls für die Unterseiten des Stabs (Funkplan LFH-548, Pressearbeit und
 * Informationstelefon LFH-554). Diese Seiten sind keine eigenen Module; sie erben Sperre und
 * Sichtbarkeit vom Stab und müssen sie deshalb selbst ermitteln, bevor sie Daten zeigen.
 *
 * **Fail-closed:** Solange die Freigabe nicht ermittelt ist, gilt `laden`; scheitert der Abruf,
 * gilt `fehler`. Beide zeigen keine Daten (Review LFH-548).
 */
export type StabFreigabe =
  | { zustand: 'laden' }
  | { zustand: 'fehler'; fehler: unknown; wiederholen: () => void }
  | { zustand: 'gesperrt' }
  | { zustand: 'frei'; overrides: ModulOverrides };

export function useStabFreigabe(einsatzId: number): StabFreigabe {
  const { benutzer } = useAuth();
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const overrides = overridesQuery.data;
  if (overrides == null) {
    if (overridesQuery.isError) {
      return {
        zustand: 'fehler',
        fehler: overridesQuery.error,
        wiederholen: () => void overridesQuery.refetch(),
      };
    }
    return { zustand: 'laden' };
  }
  if (!istKeyFreigegeben('stab', benutzer, overrides)) return { zustand: 'gesperrt' };
  return { zustand: 'frei', overrides };
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
    case 'gesperrt':
      return (
        <SeitenSackgasse
          titel={`${seite.titel} nicht verfügbar`}
          hinweis={`Das Modul Stab ist in diesem Einsatz nicht freigegeben; ${seite.mitArtikel} gehört dazu.`}
          rueckweg={{ pfad: einsatzModulPfad(einsatzId, 'ueberblick'), label: 'Zum Überblick' }}
        />
      );
  }
}
