import { Alert, App, Breadcrumb, Col, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  erledigeErinnerung, legeErinnerungAn, listeErinnerungen, quittiereErinnerung,
} from '../api/erinnerungen';
import type { Erinnerung, NeueErinnerung } from '../api/types';
import {
  ERINNERUNG_STATUS, GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, istAbgeschlossen,
  type FaelligGruppe,
} from '../kommunikation';
import ErinnerungListe from '../erinnerung/ErinnerungListe';
import ErinnerungFormular from '../erinnerung/ErinnerungFormular';

/** Schluessel-Zeitstempel der Abgeschlossen-Ansicht: erledigt ODER quittiert ODER Anlage. */
function abschlussZeit(e: Erinnerung): string {
  return e.erledigt_at ?? e.quittiert_at ?? e.erstellt_at;
}

export default function ErinnerungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Offen/Abgeschlossen-Trennung erfolgt clientseitig → ALLE Erinnerungen laden.
  const erinnerungenQuery = useQuery({
    queryKey: ['einsatz-erinnerungen', einsatzId],
    queryFn: () => listeErinnerungen(einsatzId, false),
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
  const alleErinnerungen = erinnerungenQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig ueber die gemeinsame Phasen-Semantik trennen.
  const offene = alleErinnerungen.filter((e) => !istAbgeschlossen(ERINNERUNG_STATUS[e.status]?.phase ?? 'offen'));
  const abgeschlossene = alleErinnerungen.filter((e) => istAbgeschlossen(ERINNERUNG_STATUS[e.status]?.phase ?? 'offen'));

  // Offen-Ansicht: nach Faelligkeit gruppieren, je Gruppe nach faellig_at aufsteigend.
  const offeneGruppen: { gruppe: FaelligGruppe; erinnerungen: Erinnerung[] }[] = GRUPPE_ORDNUNG
    .map((gruppe) => ({
      gruppe,
      erinnerungen: offene
        .filter((e) => faelligGruppe(e.faellig_at, e.ist_faellig) === gruppe)
        .sort((a, b) => (a.faellig_at ?? '￿').localeCompare(b.faellig_at ?? '￿')),
    }))
    .filter(({ erinnerungen }) => erinnerungen.length > 0);

  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
  const abgeschlosseneSortiert = [...abgeschlossene]
    .sort((a, b) => abschlussZeit(b).localeCompare(abschlussZeit(a)));

  const listenProps = {
    darfSchreiben,
    onErledigen: (eid: number) => erledigenMutation.mutate(eid),
    onQuittieren: (eid: number) => quittierenMutation.mutate(eid),
  };

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <Segmented
              value={ansicht}
              onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
              options={[
                { value: 'offen', label: `Offen (${offene.length})` },
                { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
              ]}
            />
          </div>
          {ansicht === 'offen' ? (
            offeneGruppen.length === 0 ? (
              <ErinnerungListe erinnerungen={[]} ansicht="offen" {...listenProps} />
            ) : (
              offeneGruppen.map(({ gruppe, erinnerungen }) => (
                <div key={gruppe} style={{ marginBottom: 16 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    {GRUPPE_LABEL[gruppe]} ({erinnerungen.length})
                  </Typography.Text>
                  <ErinnerungListe erinnerungen={erinnerungen} ansicht="offen" {...listenProps} />
                </div>
              ))
            )
          ) : (
            <ErinnerungListe erinnerungen={abgeschlosseneSortiert} ansicht="abgeschlossen" {...listenProps} />
          )}
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
