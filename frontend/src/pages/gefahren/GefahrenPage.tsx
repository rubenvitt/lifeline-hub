import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Select, Spin, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import { ApiError } from '../../api/client';
import { ladeGefahrenmatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import {
  GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe,
} from './gefahrenSchema';

interface ZeilenDaten {
  typ: Gefahrentyp;
  label: string;
}

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const matrixQuery = useQuery({ queryKey: ['gefahrenmatrix', einsatzId], queryFn: () => ladeGefahrenmatrix(einsatzId) });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const setzen = useMutation({
    mutationFn: (d: { typ: Gefahrentyp; objekt: Schutzobjekt; warnstufe: Warnstufe }) =>
      setzeBewertung(einsatzId, { gefahrentyp: d.typ, schutzobjekt: d.objekt, warnstufe: d.warnstufe }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId] }); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  // Effektive Warnstufe je (typ, objekt) aus der (keine-gefilterten) Matrix.
  const matrix: GefahrBewertung[] = matrixQuery.data ?? [];
  const warnstufeVon = (typ: Gefahrentyp, objekt: Schutzobjekt): Warnstufe => {
    const t = matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
    return t?.warnstufe ?? 'keine';
  };

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => ({
      title: obj.label,
      key: obj.wert,
      render: (_: unknown, zeile: ZeilenDaten) => {
        const gueltig = kombinationGueltig(zeile.typ, obj.wert);
        const aktuell = warnstufeVon(zeile.typ, obj.wert);
        return (
          <Select<Warnstufe>
            aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
            size="small"
            style={{ width: 110, backgroundColor: warnstufeFarbe(aktuell) }}
            value={aktuell}
            disabled={!gueltig || !darfSchreiben || setzen.isPending}
            options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
            onChange={(w) => setzen.mutate({ typ: zeile.typ, objekt: obj.wert, warnstufe: w })}
          />
        );
      },
    })),
  ];

  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <Table<ZeilenDaten>
      rowKey="typ"
      columns={spalten}
      dataSource={zeilen}
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
      loading={matrixQuery.isLoading}
    />
  );
}
