import { useNavigate } from 'react-router';
import { Button } from 'antd';

/**
 * Einstieg von einer Modul-Liste in ihre Druckansicht (LFH-727, design.md D7), wie der Knopf im
 * ETB-Kopf: öffnet und sendet nichts ab, gehört also in den Kopf-Slot — sekundär, „genau eine
 * Primäraktion" bleibt. Link mit Knopfgestalt: Strg/⌘+Klick öffnet einen Tab. Der Pfad trägt den
 * aktiven Seitenfilter (`personenDruckPfad` usw.). Unabhängig vom Schreibrecht: Drucken ist Lesen.
 */
export default function DruckAnsichtKnopf({ pfad }: { pfad: string }) {
  const navigate = useNavigate();
  return (
    <Button
      href={pfad}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(pfad);
      }}
    >
      Drucken / als PDF
    </Button>
  );
}
