import { useQuery } from '@tanstack/react-query';
import { listeExterneStellen } from '../api/externeStellen';
import { globalKeys } from '../api/queryKeys';
import type { ExterneStelle, ExterneStelleArt } from '../api/types';

/**
 * Vorschläge aus dem Katalog „Externe Stellen“ (LFH-1194, design.md D6) für die meldende Stelle
 * (`pages/EinsatzdatenPage.tsx`) und den Adressaten einer Nachforderung
 * (`nachforderungen/NachforderungFormular.tsx`). Gespeichert wird dort nur der Text; dieses
 * Modul liefert die Auswahl. LFH-1284 macht daraus die Quelle `externeStellen` des Bausteins
 * `StammdatenFeld` — dann zieht nur diese Datei um.
 */

/** Gruppen in der Reihenfolge des Backends (`externe_stelle::ExterneStelleArt::ALLE`). */
export const EXTERNE_STELLE_ARTEN: readonly ExterneStelleArt[] = [
  'leitstelle',
  'polizei',
  'behoerde',
  'hilfsorganisation',
  'sonstige',
];

export const EXTERNE_STELLE_ART_LABEL: Record<ExterneStelleArt, string> = {
  leitstelle: 'Leitstelle',
  polizei: 'Polizei',
  behoerde: 'Behörde',
  hilfsorganisation: 'Hilfsorganisation',
  sonstige: 'Sonstige',
};

/** Die aktiven Stellen der Organisation; live über `stammdaten`. */
export function useExterneStellen() {
  return useQuery({
    queryKey: globalKeys.externeStellenListe('aktiv'),
    queryFn: () => listeExterneStellen('aktiv'),
  });
}

export interface StellenOption {
  value: string;
  label: string;
}

export interface StellenGruppe {
  label: string;
  options: StellenOption[];
}

/**
 * Gruppierte `AutoComplete`-Optionen: je Art eine Gruppe in der Reihenfolge von
 * {@link EXTERNE_STELLE_ARTEN}, darin die zuständige Leitstelle vorn, dann alphabetisch. Leere
 * Gruppen fallen weg, inaktive Stellen auch. Die zuständige Leitstelle trägt das Wort
 * „zuständig“, keine Farbe allein.
 */
export function externeStellenOptionen(stellen: readonly ExterneStelle[]): StellenGruppe[] {
  return EXTERNE_STELLE_ARTEN.map((art) => ({
    label: EXTERNE_STELLE_ART_LABEL[art],
    options: stellen
      .filter((s) => s.aktiv && s.art === art)
      .sort(
        (a, b) =>
          Number(b.zustaendig) - Number(a.zustaendig) ||
          a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
      )
      .map((s) => ({
        value: s.bezeichnung,
        label: s.zustaendig ? `${s.bezeichnung} · zuständig` : s.bezeichnung,
      })),
  })).filter((g) => g.options.length > 0);
}

/** Bezeichnung der zuständigen, aktiven Leitstelle oder `undefined`. */
export function zustaendigeLeitstelle(stellen: readonly ExterneStelle[]): string | undefined {
  return stellen.find((s) => s.aktiv && s.zustaendig && s.art === 'leitstelle')?.bezeichnung;
}
