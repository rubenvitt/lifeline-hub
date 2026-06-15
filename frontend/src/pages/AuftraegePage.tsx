import { Alert, App, Breadcrumb, Col, Row, Segmented, Select, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeAuftragAn, listeAuftraege, nimmAb, quittiereEmpfaenger, setzeVollzug } from '../api/auftraege';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { NeuerAuftrag } from '../api/types';
import AuftragListe from '../auftraege/AuftragListe';
import AuftragFormular from '../auftraege/AuftragFormular';
import VollzugMeldenModal from '../auftraege/VollzugMeldenModal';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();


  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });

  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);
  // Empfänger-Filter (LFH-92): kodiert als "abschnitt:<id>" bzw. "einheit:<id>".
  const [empfFilter, setEmpfFilter] = useState<string | undefined>(undefined);
  const [empfTyp, empfId] = empfFilter ? empfFilter.split(':') : [undefined, undefined];
  const abschnittId = empfTyp === 'abschnitt' ? Number(empfId) : undefined;
  const einheitId = empfTyp === 'einheit' ? Number(empfId) : undefined;

  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId, statusFilter ?? 'alle', richtungFilter ?? 'alle', empfFilter ?? 'alle'],
    queryFn: () => listeAuftraege(einsatzId, { status: statusFilter, richtung: richtungFilter, abschnittId, einheitId }),
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

  const abschnitte = (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  const einheiten = (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const empfaengerOptionen = [
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <Segmented
              value={statusFilter ?? 'alle'}
              onChange={(v) => setStatusFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle' },
                { value: 'offen', label: 'Offen' },
                { value: 'in_arbeit', label: 'In Bearbeitung' },
                { value: 'vollzogen', label: 'Vollzogen' },
                { value: 'abgenommen', label: 'Abgenommen' },
              ]}
            />
            <Segmented
              value={richtungFilter ?? 'alle'}
              onChange={(v) => setRichtungFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle Richtungen' },
                { value: 'intern', label: 'Intern' },
                { value: 'extern', label: 'Extern' },
              ]}
            />
            <Select
              allowClear
              placeholder="Empfänger filtern"
              style={{ minWidth: 220 }}
              value={empfFilter}
              onChange={(v) => setEmpfFilter(v ?? undefined)}
              options={empfaengerOptionen}
              optionFilterProp="label"
            />
          </div>
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
            <AuftragFormular
              senden={anlegenMutation.isPending}
              abschnitte={abschnitte}
              einheiten={einheiten}
              onAnlegen={(d) => anlegenMutation.mutate(d)}
            />
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
