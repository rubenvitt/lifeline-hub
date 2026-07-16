import { useState } from 'react';
import { Button, Input, Popover, Space, Table } from 'antd';
import { Select } from '../../components/Select';
import { EditOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import type { BewertungEingabe } from '../../api/gefahren';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe } from './gefahrenSchema';

interface ZeilenDaten { typ: Gefahrentyp; label: string; }

function DetailPopover({ zelle, onSpeichern, speichert }: {
  zelle: GefahrBewertung;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => void;
  speichert: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [beschreibung, setBeschreibung] = useState(zelle.beschreibung ?? '');
  const [gemeldetVon, setGemeldetVon] = useState(zelle.gemeldet_von ?? '');
  const oeffnen = (auf: boolean) => {
    if (auf) { setBeschreibung(zelle.beschreibung ?? ''); setGemeldetVon(zelle.gemeldet_von ?? ''); }
    setOffen(auf);
  };
  const speichern = () => { onSpeichern(beschreibung.trim() || null, gemeldetVon.trim() || null); setOffen(false); };
  return (
    <Popover trigger="click" open={offen} onOpenChange={oeffnen} title="Details" content={
      <Space orientation="vertical" style={{ width: 240 }}>
        <Input.TextArea aria-label="Beschreibung" rows={2} placeholder="Beschreibung" value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} />
        <Input aria-label="Gemeldet von" placeholder="Gemeldet von" value={gemeldetVon} onChange={(e) => setGemeldetVon(e.target.value)} />
        <Button type="primary" size="small" loading={speichert} onClick={speichern}>Speichern</Button>
      </Space>
    }>
      <Button aria-label={`Details ${zelle.gefahrentyp} × ${zelle.schutzobjekt}`} size="small" type="text" icon={<EditOutlined />} />
    </Popover>
  );
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
  pending: boolean;
  onSetzen: (daten: BewertungEingabe) => void;
}

/** Wiederverwendbares 13×5-Raster für EIN Gefahrengebiet (GefahrenPage + Karten-Drawer). */
export default function GefahrenMatrix({ matrix, darfSchreiben, pending, onSetzen }: GefahrenMatrixProps) {
  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
  const warnstufeVon = (typ: Gefahrentyp, objekt: Schutzobjekt): Warnstufe =>
    zelleVon(typ, objekt)?.warnstufe ?? 'keine';

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => ({
      title: obj.label,
      key: obj.wert,
      onCell: (zeile: ZeilenDaten) => ({
        style: { backgroundColor: warnstufeFarbe(warnstufeVon(zeile.typ, obj.wert)), textAlign: 'center' as const },
      }),
      render: (_: unknown, zeile: ZeilenDaten) => {
        const gueltig = kombinationGueltig(zeile.typ, obj.wert);
        const zelle = zelleVon(zeile.typ, obj.wert);
        const aktuell = zelle?.warnstufe ?? 'keine';
        return (
          <Space size={4} align="center">
            <Select<Warnstufe>
              aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
              size="small"
              style={{ width: 110 }}
              value={aktuell}
              disabled={!gueltig || !darfSchreiben || pending}
              options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
              onChange={(w) => onSetzen({
                gefahrentyp: zeile.typ, schutzobjekt: obj.wert, warnstufe: w,
                beschreibung: zelle?.beschreibung ?? null, gemeldet_von: zelle?.gemeldet_von ?? null,
              })}
            />
            {darfSchreiben && aktuell !== 'keine' && zelle && (
              <DetailPopover zelle={zelle} speichert={pending} onSpeichern={(beschreibung, gemeldetVon) => onSetzen({
                gefahrentyp: zeile.typ, schutzobjekt: obj.wert, warnstufe: zelle.warnstufe, beschreibung, gemeldet_von: gemeldetVon,
              })} />
            )}
          </Space>
        );
      },
    })),
  ];
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <Table<ZeilenDaten> rowKey="typ" columns={spalten} dataSource={zeilen}
      pagination={false} size="small" scroll={{ x: 'max-content' }} />
  );
}
