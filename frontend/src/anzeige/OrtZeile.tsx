import { Typography } from 'antd';
import type { LatLon } from './koordinaten';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { useOrtVorschau } from './useOrtVorschau';

/** Sekundäre Ort-Zeile: «ortsname» · «distanz» «richtung» von «bezug». Additiv, degradiert leer.
 *  Nur rendern, wo eine einsatzId vorhanden ist (Hook → QueryClient nötig). */
export function OrtZeile({
  einsatzId,
  koord,
  exclude,
  debounceMs,
  maxZeilen,
}: {
  einsatzId: number;
  koord: LatLon;
  exclude?: string;
  debounceMs?: number;
  /**
   * Kürzt auf so viele Zeilen; der volle Wortlaut bleibt als Tooltip. Opt-in für schmale Flächen.
   */
  maxZeilen?: number;
}) {
  const { formatDistanz } = useAnzeigeKonventionen();
  const { data, isFetching } = useOrtVorschau(einsatzId, koord, exclude, debounceMs);

  if (!data) {
    return isFetching ? (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ort wird ermittelt …
      </Typography.Text>
    ) : null;
  }

  const teile: string[] = [];
  if (data.ortsname) teile.push(data.ortsname);
  if (data.peilung) {
    teile.push(
      `${formatDistanz(data.peilung.distanz_m)} ${data.peilung.richtung} von ${data.peilung.bezug_label}`,
    );
  }
  if (teile.length === 0) return null;

  const text = teile.join(' · ');
  // `Paragraph`, nicht `Text`: antd 6 kennt `rows` nur am Block. Der Vorgabe-Abstand muss weg,
  // den setzt der umgebende `Space`.
  if (maxZeilen != null) {
    return (
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginBottom: 0 }}
        ellipsis={{ rows: maxZeilen, tooltip: text }}
      >
        {text}
      </Typography.Paragraph>
    );
  }
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {text}
    </Typography.Text>
  );
}
