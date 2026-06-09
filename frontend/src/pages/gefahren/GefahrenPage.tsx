import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { benenneGefahrengebiet, gefahrengebietName, ladeGefahrengebiete, ladeMatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { useEinsatzLiveStream } from '../../etb/useEinsatzLiveStream';
import { warnstufeFarbe } from './gefahrenSchema';
import GefahrenMatrix from './GefahrenMatrix';

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const gebieteQuery = useQuery({ queryKey: ['gefahrengebiete', einsatzId], queryFn: () => ladeGefahrengebiete(einsatzId) });

  const gebiete = gebieteQuery.data ?? [];
  // Auswahl auf das erste Gebiet defaulten / korrigieren, wenn das gewählte verschwindet.
  useEffect(() => {
    if (gebiete.length === 0) { setGewaehlt(null); return; }
    if (gewaehlt == null || !gebiete.some((g) => g.id === gewaehlt)) setGewaehlt(gebiete[0].id);
  }, [gebiete, gewaehlt]);

  const matrixQuery = useQuery({
    queryKey: ['gefahrenmatrix', einsatzId, gewaehlt],
    queryFn: () => ladeMatrix(einsatzId, gewaehlt as number),
    enabled: gewaehlt != null,
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gewaehlt as number, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId, gewaehlt] });
      qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
    },
    onError: fehler,
  });
  const umbenennen = useMutation({
    mutationFn: (label: string) => benenneGefahrengebiet(einsatzId, gewaehlt as number, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] }),
    onError: fehler,
  });

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;

  const einsatz = einsatzQuery.data;
  const darfSchreiben = einsatz.status === 'aktiv' && (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  if (gebieteQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (gebieteQuery.isError) return <Alert type="error" message="Gefahrengebiete konnten nicht geladen werden" showIcon />;

  if (gebiete.length === 0) {
    return <Empty description="Noch keine Gefahrengebiete – auf der Lagekarte ein Gefahrengebiet zeichnen." style={{ marginTop: 64 }} />;
  }

  const aktuell = gebiete.find((g) => g.id === gewaehlt);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <List
        style={{ width: 240, flexShrink: 0 }}
        size="small"
        bordered
        header={<Typography.Text strong>Gefahrengebiete</Typography.Text>}
        dataSource={gebiete}
        renderItem={(g) => (
          <List.Item
            onClick={() => setGewaehlt(g.id)}
            style={{ cursor: 'pointer', background: g.id === gewaehlt ? 'rgba(22,119,255,0.08)' : undefined }}
          >
            <Space>
              <Tag color={g.hoechste_warnstufe === 'keine' ? undefined : warnstufeFarbe(g.hoechste_warnstufe)}>
                {g.hoechste_warnstufe}
              </Tag>
              <span>{gefahrengebietName(g.label, g.id)}</span>
              <Typography.Text type="secondary">({g.zonen_ids.length})</Typography.Text>
            </Space>
          </List.Item>
        )}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {aktuell && (
          <Typography.Title
            level={5}
            style={{ marginTop: 0 }}
            editable={darfSchreiben ? { onChange: (v) => { const t = v.trim(); if (t !== (aktuell.label ?? '')) umbenennen.mutate(t); } } : false}
          >
            {gefahrengebietName(aktuell.label, aktuell.id)}
          </Typography.Title>
        )}
        {!darfSchreiben && (
          <Alert type="info" showIcon message="Nur Lesezugriff – Bewertungen können nicht geändert werden." style={{ marginBottom: 12 }} />
        )}
        {matrixQuery.isError ? (
          <Alert type="error" message="Matrix konnte nicht geladen werden" showIcon />
        ) : (
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            darfSchreiben={darfSchreiben}
            pending={setzen.isPending}
            onSetzen={(d) => setzen.mutate(d)}
          />
        )}
      </div>
    </div>
  );
}
