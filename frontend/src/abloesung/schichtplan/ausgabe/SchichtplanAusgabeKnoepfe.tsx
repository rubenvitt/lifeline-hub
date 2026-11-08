import { Button } from 'antd';
import { useNavigate } from 'react-router';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';

/**
 * Ausgabewege des Schichtplans im Slot `werkzeuge` der Ansicht (LLH-1557, design D2): „Drucken“
 * führt zur Druckansicht, auch ohne Schreibrecht. Ein Link in Knopfgestalt, damit Strg/⌘+Klick
 * einen neuen Tab öffnet wie jeder Link.
 */
export default function SchichtplanAusgabeKnoepfe({ einsatzId }: { einsatzId: number }) {
  const navigate = useNavigate();
  const druck = schichtplanDruckPfad(einsatzId);
  return (
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
  );
}
