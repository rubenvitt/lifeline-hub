import { useId } from 'react';
import { Button, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';
import { ladeSchichtplanMappe } from '../../../api/schichtplan';
import { speichereDatei } from '../../../components/dateiSpeichern';
import { SpeicherFehler } from '../../../components/SpeicherHinweis';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { mappeDateiname } from './mappeDateiname';

interface SchichtplanAusgabeKnoepfeProps {
  einsatzId: number;
  /** Für den Dateinamen der Mappe. */
  einsatzBezeichnung: string;
  /** Ohne Freigabe des Moduls Personal ist „Excel“ gesperrt (der Server antwortete 403). */
  personalFrei: boolean;
}

/**
 * Ausgabewege des Schichtplans im Slot `werkzeuge` der Ansicht (LLH-1557, design D2), auch ohne
 * Schreibrecht. „Drucken“ führt zur Druckansicht: ein Link in Knopfgestalt, damit Strg/⌘+Klick
 * einen neuen Tab öffnet wie jeder Link. „Excel“ lädt die Mappe vom Server und bietet sie als Datei
 * an (`apiDatei` + `speichereDatei`, kein Download-Anker); ein Fehler steht an der Seite, nicht im
 * Toast, und verschwindet beim nächsten Versuch.
 */
export default function SchichtplanAusgabeKnoepfe({
  einsatzId,
  einsatzBezeichnung,
  personalFrei,
}: SchichtplanAusgabeKnoepfeProps) {
  const navigate = useNavigate();
  const grundId = useId();
  const druck = schichtplanDruckPfad(einsatzId);
  // `networkMode: 'always'` wie `useCsvExport`: ohne Netz sofort scheitern statt still warten.
  const mappe = useMutation({
    networkMode: 'always',
    mutationFn: async (id: number) => {
      const datei = await ladeSchichtplanMappe(id);
      speichereDatei(datei, mappeDateiname(einsatzBezeichnung, `einsatz-${id}`));
    },
  });
  const fuerDiesen = mappe.variables === einsatzId;
  return (
    <>
      <Button
        href={druck}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(druck);
        }}
      >
        Drucken
      </Button>
      <Button
        disabled={!personalFrei}
        loading={fuerDiesen && mappe.isPending}
        aria-describedby={personalFrei ? undefined : grundId}
        onClick={() => mappe.mutate(einsatzId)}
      >
        Excel
      </Button>
      {!personalFrei && (
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
