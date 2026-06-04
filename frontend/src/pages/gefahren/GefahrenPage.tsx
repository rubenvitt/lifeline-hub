import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Input, Popover, Select, Space, Spin, Table, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { ladeGefahrenmatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { listeZonen } from '../../api/lagezonen';
import { useEinsatzLiveStream } from '../../etb/useEinsatzLiveStream';
import {
  GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe,
} from './gefahrenSchema';

interface ZeilenDaten {
  typ: Gefahrentyp;
  label: string;
}

/** Popover-Formular für beschreibung/gemeldet_von einer bewerteten Zelle. */
function DetailPopover({
  zelle,
  onSpeichern,
  speichert,
}: {
  zelle: GefahrBewertung;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => void;
  speichert: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [beschreibung, setBeschreibung] = useState(zelle.beschreibung ?? '');
  const [gemeldetVon, setGemeldetVon] = useState(zelle.gemeldet_von ?? '');

  const oeffnen = (auf: boolean) => {
    if (auf) {
      // Beim Öffnen aus der aktuellen Zelle vorbelegen.
      setBeschreibung(zelle.beschreibung ?? '');
      setGemeldetVon(zelle.gemeldet_von ?? '');
    }
    setOffen(auf);
  };

  const speichern = () => {
    onSpeichern(beschreibung.trim() || null, gemeldetVon.trim() || null);
    setOffen(false);
  };

  return (
    <Popover
      trigger="click"
      open={offen}
      onOpenChange={oeffnen}
      title="Details"
      content={
        <Space direction="vertical" style={{ width: 240 }}>
          <Input.TextArea
            aria-label="Beschreibung"
            rows={2}
            placeholder="Beschreibung"
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
          />
          <Input
            aria-label="Gemeldet von"
            placeholder="Gemeldet von"
            value={gemeldetVon}
            onChange={(e) => setGemeldetVon(e.target.value)}
          />
          <Button type="primary" size="small" loading={speichert} onClick={speichern}>
            Speichern
          </Button>
        </Space>
      }
    >
      <Button aria-label={`Details ${zelle.gefahrentyp} × ${zelle.schutzobjekt}`} size="small" type="text" icon={<EditOutlined />} />
    </Popover>
  );
}

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const matrixQuery = useQuery({ queryKey: ['gefahrenmatrix', einsatzId], queryFn: () => ladeGefahrenmatrix(einsatzId) });
  const zonenQuery = useQuery({ queryKey: ['einsatz-zonen', einsatzId], queryFn: () => listeZonen(einsatzId) });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  // Sendet immer den vollen Zell-Zustand (warnstufe + beschreibung + gemeldet_von),
  // damit eine Warnstufen-Änderung vorhandene beschreibung/gemeldet_von nicht clobbert.
  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId] }); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (matrixQuery.isError) {
    return <Alert type="error" message="Gefahrenmatrix konnte nicht geladen werden" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  // Effektive Warnstufe je (typ, objekt) aus der (keine-gefilterten) Matrix.
  const matrix: GefahrBewertung[] = matrixQuery.data ?? [];
  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt): GefahrBewertung | undefined =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
  const warnstufeVon = (typ: Gefahrentyp, objekt: Schutzobjekt): Warnstufe =>
    zelleVon(typ, objekt)?.warnstufe ?? 'keine';

  const zonen = zonenQuery.data ?? [];
  const zonenAnzahl = (typ: Gefahrentyp, objekt: Schutzobjekt): number =>
    zonen.filter((z) => z.gefahrentyp === typ && z.schutzobjekt === objekt).length;

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => ({
      title: obj.label,
      key: obj.wert,
      // Warnstufen-Farbe garantiert sichtbar: das ganze <td> färben (unabhängig von Select-Internals).
      onCell: (zeile: ZeilenDaten) => ({
        style: { backgroundColor: warnstufeFarbe(warnstufeVon(zeile.typ, obj.wert)), textAlign: 'center' as const },
      }),
      render: (_: unknown, zeile: ZeilenDaten) => {
        const gueltig = kombinationGueltig(zeile.typ, obj.wert);
        const zelle = zelleVon(zeile.typ, obj.wert);
        const aktuell = zelle?.warnstufe ?? 'keine';
        const anzahl = zonenAnzahl(zeile.typ, obj.wert);
        return (
          <Space size={4} align="center">
            <Tooltip title={anzahl > 0 ? `${anzahl} verknüpfte Zone(n) auf der Lagekarte` : undefined}>
              <Badge count={anzahl} size="small" offset={[-4, 2]}>
                <Select<Warnstufe>
                  aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
                  size="small"
                  style={{ width: 110 }}
                  value={aktuell}
                  disabled={!gueltig || !darfSchreiben || setzen.isPending}
                  options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
                  // Vollen Zell-Zustand senden → kein Clobber von beschreibung/gemeldet_von.
                  onChange={(w) => setzen.mutate({
                    gefahrentyp: zeile.typ,
                    schutzobjekt: obj.wert,
                    warnstufe: w,
                    beschreibung: zelle?.beschreibung ?? null,
                    gemeldet_von: zelle?.gemeldet_von ?? null,
                  })}
                />
              </Badge>
            </Tooltip>
            {darfSchreiben && aktuell !== 'keine' && zelle && (
              <DetailPopover
                zelle={zelle}
                speichert={setzen.isPending}
                onSpeichern={(beschreibung, gemeldetVon) => setzen.mutate({
                  gefahrentyp: zeile.typ,
                  schutzobjekt: obj.wert,
                  warnstufe: zelle.warnstufe,
                  beschreibung,
                  gemeldet_von: gemeldetVon,
                })}
              />
            )}
          </Space>
        );
      },
    })),
  ];

  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <>
      {!darfSchreiben && (
        <Alert
          type="info"
          showIcon
          message="Nur Lesezugriff – Bewertungen können nicht geändert werden."
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<ZeilenDaten>
        rowKey="typ"
        columns={spalten}
        dataSource={zeilen}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        loading={matrixQuery.isLoading}
      />
    </>
  );
}
