import { Tag, Tooltip } from 'antd';
import { formatZeit } from './zeit';

const ERKLAERUNG =
  'Quittiert = empfangen/zur Kenntnis genommen — sagt nichts über die Erledigung.';

/**
 * Orthogonale Kenntnisnahme-Achse (LFH-112): NICHT Teil der Status-Phase.
 * Grünes Tag „✓ Quittiert" (optional von wem/wann), sonst graues „Quittung offen".
 */
export default function QuittungIndikator({ quittiert, von, am }: {
  quittiert: boolean;
  von?: string | null;
  am?: string | null;
}) {
  if (!quittiert) {
    return (
      <Tooltip title={ERKLAERUNG}>
        <Tag color="default">Quittung offen</Tag>
      </Tooltip>
    );
  }
  const zeit = formatZeit(am);
  return (
    <Tooltip title={ERKLAERUNG}>
      <Tag color="success">
        ✓ Quittiert{von ? ` von ${von}` : ''}{zeit ? ` ${zeit}` : ''}
      </Tag>
    </Tooltip>
  );
}
