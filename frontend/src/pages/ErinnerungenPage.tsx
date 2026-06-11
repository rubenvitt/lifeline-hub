import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  erledigeErinnerung, legeErinnerungAn, listeErinnerungen, quittiereErinnerung,
} from '../api/erinnerungen';
import type { NeueErinnerung } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import ErinnerungListe from '../erinnerung/ErinnerungListe';
import ErinnerungFormular from '../erinnerung/ErinnerungFormular';

export default function ErinnerungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const erinnerungenQuery = useQuery({
    queryKey: ['einsatz-erinnerungen', einsatzId],
    queryFn: () => listeErinnerungen(einsatzId, true),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-erinnerungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeueErinnerung) => legeErinnerungAn(einsatzId, daten),
    onSuccess: () => { invalidiere(); message.success('Erinnerung angelegt'); },
    onError: fehler,
  });
  const erledigenMutation = useMutation({
    mutationFn: (eid: number) => erledigeErinnerung(einsatzId, eid),
    onSuccess: invalidiere, onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: (eid: number) => quittiereErinnerung(einsatzId, eid),
    onSuccess: invalidiere, onError: fehler,
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
  const erinnerungen = erinnerungenQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Erinnerungen' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Erinnerungen</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {erinnerungenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Erinnerungen konnten nicht geladen werden" />
          )}
          <ErinnerungListe
            erinnerungen={erinnerungen}
            darfSchreiben={darfSchreiben}
            onErledigen={(eid) => erledigenMutation.mutate(eid)}
            onQuittieren={(eid) => quittierenMutation.mutate(eid)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="320px">
            <ErinnerungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
