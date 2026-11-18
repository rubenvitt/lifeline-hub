import { type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';
import { loadSchichtplanMappe } from '../../../api/schichtplan';
import { speichereDatei } from '../../../components/dateiSpeichern';
import type { Nebenweg } from '../../../components/EinsatzSeite';
import { druckansichtNebenweg } from '../../../components/druck/useDruckNebenwege';
import { SpeicherFehler } from '../../../components/SpeicherHinweis';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { mappeDateiname } from './mappeDateiname';

/** Die Ausgabewege eines Plans für den Kopf, dazu der Fehler der Mappe für die Ansicht. */
export interface AusgabeWege {
  /** „Druckansicht“ und „Excel“, als Nebenwege des Seitenkopfs (LLH-1836). */
  nebenwege: Nebenweg[];
  /** Fehler des letzten Excel-Abrufs dieses Plans; steht an der Ansicht, nicht im Kopf. */
  fehler: ReactNode;
}

interface AusgabeProps {
  /** Ziel von „Druckansicht“. */
  druckPfad: string;
  /** Eindeutig je Plan (`einsatz-5`, `planung-3`): Laden und Fehler gelten nur für diesen. */
  schluessel: string;
  ladeMappe: () => Promise<Blob>;
  dateiname: () => string;
  /** Ohne Freigabe des Moduls Personal ist „Excel“ gesperrt und nennt den Grund; `undefined`:
   *  gesperrt, solange die Freigaben laden, noch ohne Grund. */
  personalFrei: boolean | undefined;
}

/**
 * „Druckansicht“ und „Excel“ eines Plans (Einsatz oder Planung, LLH-1557) als Nebenwege des
 * Seitenkopfs (LLH-1836, `druck/AGENTS.md`, „Wortlaut und Platz“): ab `md` Knöpfe, darunter im Menü
 * „Weitere“. „Druckansicht“ ist ein Link in Knopfgestalt (Strg/⌘+Klick öffnet einen Tab). „Excel“
 * lädt die Mappe vom Server und bietet sie als Datei an (`apiDatei` + `speichereDatei`, kein
 * Download-Anker); gesperrt nennt das `label` den Grund (LFH-1079), ein Fehler steht an der Ansicht,
 * nicht im Toast, und verschwindet beim nächsten Versuch.
 */
export function useAusgabeNebenwege({
  druckPfad,
  schluessel,
  ladeMappe,
  dateiname,
  personalFrei,
}: AusgabeProps): AusgabeWege {
  const navigate = useNavigate();
  // `networkMode: 'always'` wie `useCsvExport`: ohne Netz sofort scheitern statt still warten.
  // Die Variable ist der Schlüssel des Plans, für den geladen wird.
  const mappe = useMutation<void, Error, string>({
    networkMode: 'always',
    mutationFn: async () => {
      const datei = await ladeMappe();
      speichereDatei(datei, dateiname());
    },
  });
  const fuerDiesen = mappe.variables === schluessel;
  const excel: Nebenweg = {
    key: 'excel',
    label: personalFrei === false ? `Excel (${MODUL_PERSONAL_GESPERRT})` : 'Excel',
    laeuft: fuerDiesen && mappe.isPending,
    onWahl: () => mappe.mutate(schluessel),
    ...(personalFrei !== true ? { gesperrt: true as const } : {}),
  };
  return {
    nebenwege: [druckansichtNebenweg({ ziel: druckPfad, navigate }), excel],
    fehler:
      fuerDiesen && mappe.error != null ? (
        <SpeicherFehler
          fehler={mappe.error}
          titel="Excel fehlgeschlagen"
          fallback="Keine Verbindung zum Server — Excel nicht möglich"
        />
      ) : null,
  };
}

/** Die Ausgabewege des Schichtplans eines Einsatzes (Ansicht Schichtplan der Ablösung). */
export function useSchichtplanAusgabe({
  einsatzId,
  einsatzBezeichnung,
  personalFrei,
}: {
  einsatzId: number;
  /** Für den Dateinamen der Mappe; erst beim Speichern gelesen. */
  einsatzBezeichnung: () => string;
  /** Ohne Freigabe des Moduls Personal ist „Excel“ gesperrt (der Server antwortete 403). */
  personalFrei: boolean | undefined;
}): AusgabeWege {
  return useAusgabeNebenwege({
    druckPfad: schichtplanDruckPfad(einsatzId),
    schluessel: `einsatz-${einsatzId}`,
    ladeMappe: () => loadSchichtplanMappe(einsatzId),
    dateiname: () => mappeDateiname(einsatzBezeichnung(), `einsatz-${einsatzId}`),
    personalFrei,
  });
}
