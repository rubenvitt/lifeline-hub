import { Alert, App, Breadcrumb, Col, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, ladeMitglieder } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeMeldungAn, listeMeldungen, markiereLagerelevant, setzeMeldungStatus, weiseBearbeiterZu } from '../api/meldungen';
import type { MeldungStatus, NeueMeldung } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';

export default function MeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const mitgliederQuery = useQuery({ queryKey: ['einsatz-mitglieder', einsatzId], queryFn: () => ladeMitglieder(einsatzId) });
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // 'offen' ist eine clientseitige Sammelsicht (status != 'erledigt') über `ist_offen`;
  // der Server filtert nur exakte Einzelstatus.
  const REALE_STATUS = ['neu', 'gesichtet', 'in_bearbeitung', 'erledigt'];
  const serverStatus = statusFilter && REALE_STATUS.includes(statusFilter) ? statusFilter : undefined;

  const meldungenQuery = useQuery({
    queryKey: ['einsatz-meldungen', einsatzId, statusFilter ?? 'alle'],
    queryFn: () => listeMeldungen(einsatzId, { status: serverStatus }),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-meldungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueMeldung) => legeMeldungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Meldung erfasst'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ meldungId, status }: { meldungId: number; status: MeldungStatus }) =>
      setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const zuweisenMutation = useMutation({
    mutationFn: ({ meldungId, bearbeiterId }: { meldungId: number; bearbeiterId: number | null }) =>
      weiseBearbeiterZu(einsatzId, meldungId, bearbeiterId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const lageMutation = useMutation({
    mutationFn: (meldungId: number) => markiereLagerelevant(einsatzId, meldungId),
    onSuccess: () => {
      invalidiere();
      qc.invalidateQueries({ queryKey: ['einsatz-lagemeldungen', einsatzId] });
      message.success('An die Lage übergeben');
    },
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
  const alleMeldungen = meldungenQuery.data ?? [];
  // 'offen' (kein Server-Status) → clientseitig auf nicht-erledigte einschränken.
  const meldungen = statusFilter === 'offen' ? alleMeldungen.filter((m) => m.ist_offen) : alleMeldungen;
  const mitglieder = mitgliederQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Meldungen (eingehend)' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Meldungen (eingehend)</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {meldungenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Meldungen konnten nicht geladen werden" />
          )}
          <div style={{ marginBottom: 12 }}>
            <Segmented
              value={statusFilter ?? 'alle'}
              onChange={(v) => setStatusFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle' },
                { value: 'offen', label: 'Offen' },
                { value: 'neu', label: 'Neu' },
                { value: 'gesichtet', label: 'Gesichtet' },
                { value: 'in_bearbeitung', label: 'In Arbeit' },
                { value: 'erledigt', label: 'Abgeschlossen' },
              ]}
            />
          </div>
          <MeldungListe
            meldungen={meldungen}
            darfSchreiben={darfSchreiben}
            mitglieder={mitglieder}
            onStatus={(meldungId, status) => statusMutation.mutate({ meldungId, status })}
            onZuweisen={(meldungId, bearbeiterId) => zuweisenMutation.mutate({ meldungId, bearbeiterId })}
            onLagerelevant={(meldungId) => lageMutation.mutate(meldungId)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <MeldungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
