import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import {
  formatFlaeche,
  formatLaenge,
  type GeoKennzahlen as GeoKennzahlenWerte,
} from '../pages/lagekarte/geo';
import { schrift } from '../theme/tokens';

export type { GeoKennzahlenWerte };

interface KennzahlZeileProps {
  /** Beschriftung links, in der gedämpften Metadaten-Stimme. */
  label: string;
  /** Wert rechts. */
  wert: ReactNode;
  /**
   * Wert in der Zahlenschrift mit `tabular-nums` setzen (Default: ja).
   *
   * `false` für Werte, die keine Zahl sind — die Warnstufe im `ZonenInspector` ist ein
   * `<Tag>`, dem die Monospace-Zahlenschrift nicht gehört. antds `Tag` setzt selbst keine
   * `font-family`, würde sie also erben.
   */
  zahl?: boolean;
}

/**
 * Eine Label→Wert-Zeile im Kennzahlen-Raster.
 *
 * Exportiert, damit der `zusatz`-Slot Zeilen im **selben** Layout beisteuern kann, statt
 * die Seite zwei Raster mischen zu lassen (Plan Task 5).
 */
export function KennzahlZeile({ label, wert, zahl = true }: KennzahlZeileProps) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: token.marginSM,
      }}
    >
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text
        style={
          zahl
            ? { fontFamily: schrift.zahl, fontVariantNumeric: 'tabular-nums' }
            : undefined
        }
      >
        {wert}
      </Typography.Text>
    </div>
  );
}

export interface GeoKennzahlenProps {
  /** Kennzahlen aus `geoKennzahlen()`; `null`, wenn die Geometrie keine hergibt. */
  kennzahlen: GeoKennzahlenWerte | null;
  /**
   * Weitere Zeilen im selben Raster — für Werte, die keine Geo-Kennzahlen sind
   * (Warnstufe, Zonen-Anzahl im `ZonenInspector`). Aus `KennzahlZeile` gebaut.
   */
  zusatz?: ReactNode;
}

/**
 * Fläche / Umfang / Länge einer Geometrie als Label→Wert-Zeilen (LFH-328/A2, Task 5).
 *
 * Vereint die drei Bauweisen, die es vorher für dasselbe Tripel gab: zweimal ein
 * `Descriptions` mit punktueller Kleingröße (`Inspector`, `FachebenenInspector`) und einmal
 * ein rohes Flex-Raster (`ZonenInspector`). Gewonnen hat die **Flex-Variante** — sie trägt
 * den `zusatz`-Fall, und die punktuelle Kleingröße läuft gegen Gate 4 (die Dichte kommt aus
 * dem `ConfigProvider`, nicht aus verstreuten Größenangaben).
 *
 * Die Zahlen stehen in `schrift.zahl` mit `font-variant-numeric: tabular-nums`
 * (A0 Signatur-Element 3, „Zahlen als Instrument"): so stehen die Stellen untereinander.
 *
 * **Formatiert wird über `pages/lagekarte/geo.ts`** (`formatFlaeche`/`formatLaenge`, Intl
 * de-DE, hart metrisch). Die Vereinheitlichung mit `anzeige/format.ts:formatDistanz`
 * (`toFixed`, respektiert das Einheitensystem) ist **verboten** — beide Formate sind
 * gepinnt, die Zusammenführung ist ein eigenes Ticket (Spec §3.2 / §5 Befund 2).
 *
 * Ohne Kennzahlen und ohne Zusatz rendert die Komponente nichts.
 */
export default function GeoKennzahlen({ kennzahlen, zusatz }: GeoKennzahlenProps) {
  const { token } = theme.useToken();
  const hatGeo =
    kennzahlen != null &&
    (kennzahlen.flaecheM2 != null || kennzahlen.umfangM != null || kennzahlen.laengeM != null);
  if (!hatGeo && !zusatz) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
      {kennzahlen?.flaecheM2 != null && (
        <KennzahlZeile label="Fläche" wert={formatFlaeche(kennzahlen.flaecheM2)} />
      )}
      {kennzahlen?.umfangM != null && (
        <KennzahlZeile label="Umfang" wert={formatLaenge(kennzahlen.umfangM)} />
      )}
      {kennzahlen?.laengeM != null && (
        <KennzahlZeile label="Länge" wert={formatLaenge(kennzahlen.laengeM)} />
      )}
      {zusatz}
    </div>
  );
}
