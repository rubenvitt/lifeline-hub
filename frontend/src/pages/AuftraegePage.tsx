import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeAuftragAn, listeAuftraege, nimmAb, quittiereEmpfaenger, setzeVollzug } from '../api/auftraege';
import type { NeuerAuftrag } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import AuftragListe from '../auftraege/AuftragListe';
import AuftragFormular from '../auftraege/AuftragFormular';
import VollzugMeldenModal from '../auftraege/VollzugMeldenModal';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId],
    queryFn: () => listeAuftraege(einsatzId),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-auftraege', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeuerAuftrag) => legeAuftragAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Auftrag erteilt'); },
    onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: ({ auftragId, empfaengerId }: { auftragId: number; empfaengerId: number }) =>
      quittiereEmpfaenger(einsatzId, auftragId, empfaengerId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const [vollzugFuer, setVollzugFuer] = useState<number | null>(null);
  const vollzugMutation = useMutation({
    mutationFn: ({ auftragId, status, text }: { auftragId: number; status: 'in_arbeit' | 'vollzogen'; text?: string }) =>
      setzeVollzug(einsatzId, auftragId, status, text),
    onSuccess: () => { invalidiere(); setVollzugFuer(null); },
    onError: fehler,
  });
  const abnahmeMutation = useMutation({
    mutationFn: (auftragId: number) => nimmAb(einsatzId, auftragId),
    onSuccess: invalidiere,
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
  const auftraege = auftraegeQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Aufträge/Befehle' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Aufträge/Befehle</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {auftraegeQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Aufträge konnten nicht geladen werden" />
          )}
          <AuftragListe
            auftraege={auftraege}
            darfSchreiben={darfSchreiben}
            onQuittieren={(auftragId, empfaengerId) => quittierenMutation.mutate({ auftragId, empfaengerId })}
            onInArbeit={(auftragId) => vollzugMutation.mutate({ auftragId, status: 'in_arbeit' })}
            onVollzugMelden={(auftragId) => setVollzugFuer(auftragId)}
            onAbnehmen={(auftragId) => abnahmeMutation.mutate(auftragId)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <AuftragFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
      <VollzugMeldenModal
        offen={vollzugFuer !== null}
        onAbbrechen={() => setVollzugFuer(null)}
        onBestaetigen={(text) =>
          vollzugFuer != null && vollzugMutation.mutate({ auftragId: vollzugFuer, status: 'vollzogen', text })}
      />
    </div>
  );
}
