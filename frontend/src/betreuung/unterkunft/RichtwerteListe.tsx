import { Space, Tag, Typography } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import type { RichtwertEbenen, RichtwertHerkunft, UnterkunftRichtwerte } from '../../api/types';
import { DezimalFeld } from '../../components/DezimalFeld';
import { MengenFeld } from '../../components/MengenFeld';
import { Paneel, useRollen } from '../../components/instrument';
import { mitVorgabe, orgVorgabe } from '../../components/vorgabeText';
import { menge } from './ErgebnisAnzeige';
import { RICHTWERTE_BASIS, type RichtwertBasis, type RichtwertGruppe } from './richtwerte';

export const GRUPPE_TITEL: Record<RichtwertGruppe, string> = {
  schlafen: 'Schlafen',
  sanitaer: 'Sanitär',
  gesundheit: 'Gesundheit',
  versorgung: 'Ver- und Entsorgung',
  verpflegung: 'Verpflegung',
  zelte: 'Zelte',
};

export const HERKUNFT_LABEL: Record<RichtwertHerkunft, string> = {
  basis: 'Vorgabe',
  org: 'Organisation',
  einsatz: 'Einsatz',
};

const GRUPPEN = Object.keys(GRUPPE_TITEL) as RichtwertGruppe[];

/** „4 m²“, „50 %“, „20 Personen“. */
export function richtwertText(wert: number, einheit: string): string {
  return einheit ? `${menge(wert)} ${einheit}` : menge(wert);
}

/** Welche Ebene diese Liste bearbeitet; `anzeige` liest nur. */
export type RichtwertEbene = 'anzeige' | 'org' | 'einsatz';

interface Props {
  ebenen: UnterkunftRichtwerte | undefined;
  ebene: RichtwertEbene;
  /** Nur bei `org`/`einsatz`: Wert setzen, `null` = erbt. */
  onSetzen?: (schluessel: string, wert: number | null) => void;
  /** Schlüssel, deren Speichern gerade läuft. */
  laeuft?: string | null;
  gesperrt?: boolean;
}

/**
 * Richtwerte des Unterkunftsrechners (LLH-1520, design.md D2), gruppiert wie die Paneele des
 * Ergebnisses. Jede Zeile nennt den wirksamen Wert, seine Herkunft und die Vorgabe; in Stammdaten
 * und Einsatz-Einstellungen ist der Wert der eigenen Ebene ein Feld, leer erbt er.
 */
export default function RichtwerteListe({ ebenen, ebene, onSetzen, laeuft, gesperrt }: Props) {
  const nachSchluessel = new Map((ebenen?.werte ?? []).map((w) => [w.schluessel, w]));
  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {GRUPPEN.map((g) => (
        <Paneel key={g} titel={GRUPPE_TITEL[g]}>
          {RICHTWERTE_BASIS.filter((b) => b.gruppe === g).map((b) => (
            <RichtwertZeile
              key={b.schluessel}
              basis={b}
              ebenen={nachSchluessel.get(b.schluessel)}
              ebene={ebene}
              onSetzen={onSetzen}
              laeuft={laeuft === b.schluessel}
              gesperrt={gesperrt}
            />
          ))}
        </Paneel>
      ))}
    </Space>
  );
}

function RichtwertZeile({
  basis: b,
  ebenen: e,
  ebene,
  onSetzen,
  laeuft,
  gesperrt,
}: {
  basis: RichtwertBasis;
  ebenen: RichtwertEbenen | undefined;
  ebene: RichtwertEbene;
  onSetzen?: (schluessel: string, wert: number | null) => void;
  laeuft: boolean;
  gesperrt?: boolean;
}) {
  const { token } = useRollen();
  const wert = e?.wert ?? b.wert;
  const herkunft: RichtwertHerkunft = e?.herkunft ?? 'basis';
  const eigen =
    ebene === 'org' ? (e?.org ?? null) : ebene === 'einsatz' ? (e?.einsatz ?? null) : null;
  // Was gilt, wenn das Feld leer ist: beim Einsatz die Organisation, sonst die Basis.
  const geerbt = ebene === 'einsatz' && e?.org != null ? e.org : b.wert;
  const [entwurf, setEntwurf] = useState<number | null>(eigen);
  useEffect(() => setEntwurf(eigen), [eigen]);

  const zeile: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: token.marginSM,
    alignItems: 'center',
    paddingBlock: token.paddingSM,
    paddingInline: token.padding,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
  };

  function uebernehmen() {
    if (!onSetzen || entwurf === eigen) return;
    onSetzen(b.schluessel, entwurf);
  }

  const feldProps = {
    beschriftung: `${b.bezeichnung} (${b.einheit || 'Anteil'})`,
    min: b.min,
    max: b.max,
    value: entwurf,
    placeholder:
      ebene === 'einsatz' && e?.org != null
        ? richtwertText(geerbt, b.einheit)
        : mitVorgabe(richtwertText(b.wert, b.einheit)),
    disabled: gesperrt || laeuft,
    onChange: (v: number | null) => setEntwurf(v),
    onBlur: uebernehmen,
    onPressEnter: uebernehmen,
    style: { width: '100%' },
  };

  return (
    <div style={zeile} data-schluessel={b.schluessel}>
      <Space size={6} wrap>
        <Typography.Text>{b.bezeichnung}</Typography.Text>
        {b.herkunft === 'annahme' && <Tag variant="filled">Annahme</Tag>}
      </Space>
      {ebene === 'anzeige' ? (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {richtwertText(wert, b.einheit)}
        </Typography.Text>
      ) : (
        <div style={{ display: 'grid', gap: 2 }}>
          {b.ganzzahl ? <MengenFeld {...feldProps} /> : <DezimalFeld stellen={2} {...feldProps} />}
          {ebene === 'einsatz' && e?.org != null && entwurf == null && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {orgVorgabe(richtwertText(e.org, b.einheit))}
            </Typography.Text>
          )}
        </div>
      )}
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
        {HERKUNFT_LABEL[herkunft]}
        {herkunft !== 'basis' && ` · ${mitVorgabe(richtwertText(b.wert, b.einheit))}`}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
        {b.quelle}
      </Typography.Text>
    </div>
  );
}
