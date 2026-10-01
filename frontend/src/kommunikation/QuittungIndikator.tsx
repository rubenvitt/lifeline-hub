import { Tooltip } from 'antd';
import { StatusChip } from '../components/instrument';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';

const ERKLAERUNG = 'Quittiert = empfangen/zur Kenntnis genommen — sagt nichts über die Erledigung.';

/**
 * Orthogonale Kenntnisnahme-Achse, NICHT Teil der Status-Phase: `normal` „✓ Quittiert"
 * (optional von wem/wann), sonst neutral „Quittung offen". Die Hülle (`span`) trägt den
 * Tooltip, weil `StatusChip` keine Referenz durchreicht.
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
  if (!quittiert) {
    return (
      <Tooltip title={ERKLAERUNG}>
        <span style={{ display: 'inline-flex' }}>
          <StatusChip ton="neutral" wort="Quittung offen" />
        </span>
      </Tooltip>
    );
  }
  const zeit = formatZeit(am);
  return (
    <Tooltip title={ERKLAERUNG}>
      <span style={{ display: 'inline-flex' }}>
        <StatusChip
          ton="normal"
          wort={`✓ Quittiert${von ? ` von ${von}` : ''}${zeit ? ` ${zeit}` : ''}`}
        />
      </span>
    </Tooltip>
  );
}
