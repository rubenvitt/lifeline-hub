import { StatusChip } from '../components/instrument';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';

/**
 * Orthogonale Kenntnisnahme-Achse, NICHT Teil der Status-Phase: `normal` „✓ Quittiert"
 * (optional von wem/wann), sonst neutral „Quittung offen". Ohne Tooltip (LFH-959): das Wort im
 * Chip trägt die Aussage, „Quittieren" heißt in der Oberfläche nur Empfang bestätigt.
 */
export default function QuittungIndikator({
  quittiert,
  von,
  am,
}: {
  quittiert: boolean;
  von?: string | null;
  am?: string | null;
}) {
  // Quittierzeit in der Anzeigezone (LFH-692).
  const { formatZeit } = useAnzeigeKonventionen();
  if (!quittiert) return <StatusChip ton="neutral" wort="Quittung offen" />;
  const zeit = formatZeit(am);
  return (
    <StatusChip
      ton="normal"
      wort={`✓ Quittiert${von ? ` von ${von}` : ''}${zeit ? ` ${zeit}` : ''}`}
    />
  );
}
