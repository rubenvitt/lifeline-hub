import { Space, Typography } from 'antd';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { OrtZeile } from './OrtZeile';

/** Read-only-Anzeige einer Koordinate (formatbewusst) + additive Ort-Zeile (Peilung + Ortsname).
 *  Ohne `einsatzId` nur die Koordinate (kein Hook → kein QueryClient-Zwang). Für statische
 *  Werte feuert die Ort-Zeile sofort (debounceMs=0). */
export default function KoordinatenAnzeige({
  lat,
  lon,
  einsatzId,
  exclude,
  maxOrtZeilen,
}: {
  lat: number;
  lon: number;
  einsatzId?: number;
  exclude?: string;
  /** Durchgereicht an die Ort-Zeile: kürzt sie auf so viele Zeilen (Tooltip trägt den
   *  vollen Wortlaut). Nur für schmale Flächen wie den Karten-Inspector. */
  maxOrtZeilen?: number;
}) {
  const { formatKoordinate } = useAnzeigeKonventionen();
  return (
    <Space orientation="vertical" size={0}>
      <Typography.Text>{formatKoordinate(lat, lon)}</Typography.Text>
      {einsatzId != null && (
        <OrtZeile einsatzId={einsatzId} koord={{ lat, lon }} exclude={exclude} debounceMs={0} maxZeilen={maxOrtZeilen} />
      )}
    </Space>
  );
}
