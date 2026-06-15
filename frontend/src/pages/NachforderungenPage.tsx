import { Alert, App, Breadcrumb, Col, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeNachforderungAn, lehneNachforderungAb, listeNachforderungen, setzeNachforderungStatus } from '../api/nachforderungen';
import type { NachforderungStatus, NeueNachforderung } from '../api/types';
import NachforderungListe from '../nachforderungen/NachforderungListe';
import NachforderungFormular from '../nachforderungen/NachforderungFormular';

export default function NachforderungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const nfQuery = useQuery({
    queryKey: ['einsatz-nachforderungen', einsatzId, statusFilter ?? 'alle'],
    queryFn: () => listeNachforderungen(einsatzId, { status: statusFilter }),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-nachforderungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueNachforderung) => legeNachforderungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Nachforderung abgesetzt'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ nfId, status }: { nfId: number; status: NachforderungStatus }) =>
      setzeNachforderungStatus(einsatzId, nfId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const ablehnenMutation = useMutation({
    mutationFn: (nfId: number) => lehneNachforderungAb(einsatzId, nfId),
    onSuccess: () => { invalidiere(); message.success('Nachforderung abgelehnt'); },
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
  const nachforderungen = nfQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Nachforderung' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Nachforderung Kräfte/Mittel</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {nfQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Nachforderungen konnten nicht geladen werden" />
          )}
          <div style={{ marginBottom: 12 }}>
            <Segmented
              value={statusFilter ?? 'alle'}
              onChange={(v) => setStatusFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle' },
                { value: 'angefordert', label: 'Angefordert' },
                { value: 'zugesagt', label: 'Zugesagt' },
                { value: 'unterwegs', label: 'Unterwegs' },
                { value: 'eingetroffen', label: 'Eingetroffen' },
                { value: 'abgelehnt', label: 'Abgelehnt' },
              ]}
            />
          </div>
          <NachforderungListe
            nachforderungen={nachforderungen}
            darfSchreiben={darfSchreiben}
            onStatus={(nfId, status) => statusMutation.mutate({ nfId, status })}
            onAblehnen={(nfId) => ablehnenMutation.mutate(nfId)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <NachforderungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
