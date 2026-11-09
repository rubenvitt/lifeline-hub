import { useId } from 'react';
import { Button, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';
import { loadSchichtplanMappe } from '../../../api/schichtplan';
import { speichereDatei } from '../../../components/dateiSpeichern';
import { SpeicherFehler } from '../../../components/SpeicherHinweis';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { mappeDateiname } from './mappeDateiname';

interface SchichtplanAusgabeKnoepfeProps {
  einsatzId: number;
  /** Für den Dateinamen der Mappe. */
  einsatzBezeichnung: string;
  /** Ohne Freigabe des Moduls Personal ist „Excel“ gesperrt (der Server antwortete 403);
   *  `undefined`, solange die Freigaben laden: gesperrt, aber noch ohne Grund (`freigabeVon`). */
  personalFrei: boolean | undefined;
}

/**
 * Ausgabewege des Schichtplans im Slot `werkzeuge` der Ansicht (LLH-1557, design D2), auch ohne
 * Schreibrecht. Die Knöpfe selbst sind {@link AusgabeKnoepfe}, die auch die Planungsseite nutzt.
 */
export default function SchichtplanAusgabeKnoepfe({
  einsatzId,
  einsatzBezeichnung,
  personalFrei,
}: SchichtplanAusgabeKnoepfeProps) {
  return (
    <AusgabeKnoepfe
      druckPfad={schichtplanDruckPfad(einsatzId)}
      schluessel={`einsatz-${einsatzId}`}
      ladeMappe={() => loadSchichtplanMappe(einsatzId)}
      dateiname={() => mappeDateiname(einsatzBezeichnung, `einsatz-${einsatzId}`)}
      personalFrei={personalFrei}
    />
  );
}

interface AusgabeKnoepfeProps {
  /** Ziel von „Drucken“. */
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
 * „Drucken“ und „Excel“ eines Plans (Einsatz oder Planung, LLH-1557). „Drucken“ führt zur
 * Druckansicht: ein Link in Knopfgestalt, damit Strg/⌘+Klick einen neuen Tab öffnet wie jeder
 * Link. „Excel“ lädt die Mappe vom Server und bietet sie als Datei an (`apiDatei` +
 * `speichereDatei`, kein Download-Anker); ein Fehler steht an der Seite, nicht im Toast, und
 * verschwindet beim nächsten Versuch.
 */
export function AusgabeKnoepfe({
  druckPfad,
  schluessel,
  ladeMappe,
  dateiname,
  personalFrei,
}: AusgabeKnoepfeProps) {
  const navigate = useNavigate();
  const grundId = useId();
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
  return (
    <>
      <Button
        href={druckPfad}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(druckPfad);
        }}
      >
        Drucken
      </Button>
      <Button
        disabled={personalFrei !== true}
        loading={fuerDiesen && mappe.isPending}
        aria-describedby={personalFrei === false ? grundId : undefined}
        onClick={() => mappe.mutate(schluessel)}
      >
        Excel
      </Button>
      {personalFrei === false && (
        <Typography.Text type="secondary" id={grundId} data-lfh="mappe-gesperrt">
          {MODUL_PERSONAL_GESPERRT}
        </Typography.Text>
      )}
      {fuerDiesen && mappe.error != null && (
        <div style={{ flexBasis: '100%' }}>
          <SpeicherFehler
            fehler={mappe.error}
            titel="Excel fehlgeschlagen"
            fallback="Keine Verbindung zum Server — Excel nicht möglich"
          />
        </div>
      )}
    </>
  );
}
