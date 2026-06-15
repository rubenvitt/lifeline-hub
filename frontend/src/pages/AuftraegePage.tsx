import { Alert, App, Breadcrumb, Col, Row, Segmented, Select, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeAuftragAn, listeAuftraege, nimmAb, quittiereEmpfaenger, setzeVollzug } from '../api/auftraege';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Auftrag, NeuerAuftrag } from '../api/types';
import {
  AUFTRAG_STATUS, GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, istAbgeschlossen,
  type FaelligGruppe,
} from '../kommunikation';
import AuftragListe from '../auftraege/AuftragListe';
import AuftragFormular from '../auftraege/AuftragFormular';
import VollzugMeldenModal from '../auftraege/VollzugMeldenModal';

const PRIO_ORDNUNG: Record<string, number> = { sofort: 0, dringend: 1, normal: 2 };

/** Offene Aufträge: nach Prio (sofort→dringend→normal), dann Frist (früheste zuerst). */
function vergleicheOffen(a: Auftrag, b: Auftrag): number {
  const prio = (PRIO_ORDNUNG[a.prioritaet] ?? 99) - (PRIO_ORDNUNG[b.prioritaet] ?? 99);
  if (prio !== 0) return prio;
  return (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿');
}

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });

  // Offen/Abgeschlossen-Trennung erfolgt clientseitig (alle Aufträge laden).
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);
  // Empfänger-Filter (LFH-92): kodiert als "abschnitt:<id>" bzw. "einheit:<id>".
  const [empfFilter, setEmpfFilter] = useState<string | undefined>(undefined);
  const [empfTyp, empfId] = empfFilter ? empfFilter.split(':') : [undefined, undefined];
  const abschnittId = empfTyp === 'abschnitt' ? Number(empfId) : undefined;
  const einheitId = empfTyp === 'einheit' ? Number(empfId) : undefined;

  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId, richtungFilter ?? 'alle', empfFilter ?? 'alle'],
    queryFn: () => listeAuftraege(einsatzId, { richtung: richtungFilter, abschnittId, einheitId }),
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
  const alleAuftraege = auftraegeQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen.
  const offene = alleAuftraege.filter((a) => !istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));
  const abgeschlossene = alleAuftraege.filter((a) => istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));

  // Offen-Ansicht: nach Fälligkeit gruppieren, je Gruppe nach Prio dann Frist.
  const offeneGruppen: { gruppe: FaelligGruppe; auftraege: Auftrag[] }[] = GRUPPE_ORDNUNG
    .map((gruppe) => ({
      gruppe,
      auftraege: offene
        .filter((a) => faelligGruppe(a.frist_at, a.ist_ueberfaellig) === gruppe)
        .sort(vergleicheOffen),
    }))
    .filter(({ auftraege }) => auftraege.length > 0);

  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach abgenommen_at/vollzogen_at).
  const abgeschlosseneSortiert = [...abgeschlossene].sort((a, b) => {
    const ka = a.abgenommen_at ?? a.vollzogen_at ?? a.erstellt_at;
    const kb = b.abgenommen_at ?? b.vollzogen_at ?? b.erstellt_at;
    return kb.localeCompare(ka);
  });

  const abschnitte = (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  const einheiten = (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const empfaengerOptionen = [
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

  const listenProps = {
    einsatzId,
    darfSchreiben,
    onQuittieren: (auftragId: number, empfaengerId: number) => quittierenMutation.mutate({ auftragId, empfaengerId }),
    onInArbeit: (auftragId: number) => vollzugMutation.mutate({ auftragId, status: 'in_arbeit' as const }),
    onVollzugMelden: (auftragId: number) => setVollzugFuer(auftragId),
    onAbnehmen: (auftragId: number) => abnahmeMutation.mutate(auftragId),
  };

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
              value={ansicht}
              onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
              options={[
                { value: 'offen', label: `Offen (${offene.length})` },
                { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
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
          {ansicht === 'offen' ? (
            offeneGruppen.length === 0 ? (
              <AuftragListe auftraege={[]} ansicht="offen" {...listenProps} />
            ) : (
              offeneGruppen.map(({ gruppe, auftraege }) => (
                <div key={gruppe} style={{ marginBottom: 16 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    {GRUPPE_LABEL[gruppe]} ({auftraege.length})
                  </Typography.Text>
                  <AuftragListe auftraege={auftraege} ansicht="offen" {...listenProps} />
                </div>
              ))
            )
          ) : (
            <AuftragListe auftraege={abgeschlosseneSortiert} ansicht="abgeschlossen" {...listenProps} />
          )}
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
