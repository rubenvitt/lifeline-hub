import { Alert, App, Breadcrumb, Button, Spin } from 'antd';
import { CloseOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import {
  erledigeErinnerung,
  legeErinnerungAn,
  listeErinnerungen,
  oeffneErinnerung,
  quittiereErinnerung,
} from '../api/erinnerungen';
import type { Erinnerung, NeueErinnerung } from '../api/types';
import {
  ERINNERUNG_STATUS,
  GRUPPE_LABEL,
  GRUPPE_ORDNUNG,
  faelligGruppe,
  istAbgeschlossen,
  type FaelligGruppe,
} from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import ErinnerungListe from '../erinnerung/ErinnerungListe';
import ErinnerungFormular from '../erinnerung/ErinnerungFormular';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, useRollen } from '../components/instrument';

/** Schluessel-Zeitstempel der Abgeschlossen-Ansicht: erledigt ODER quittiert ODER Anlage. */
function abschlussZeit(e: Erinnerung): string {
  return e.erledigt_at ?? e.quittiert_at ?? e.erstellt_at;
}

export default function ErinnerungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  // Inline-Anlegen-Formular (LFH-112): per Kopf-Button auf-/zugeklappt, kein Drawer/Sidebar.
  const [formOffen, setFormOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Offen/Abgeschlossen-Trennung erfolgt clientseitig → ALLE Erinnerungen laden.
  const erinnerungenQuery = useQuery({
    queryKey: einsatzKeys.erinnerungen(einsatzId),
    queryFn: () => listeErinnerungen(einsatzId, false),
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(einsatzId) });

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeueErinnerung) => legeErinnerungAn(einsatzId, daten),
    // LFH-343/C8: kein `setFormOffen(false)` mehr — das Inline-Formular bleibt
    // offen, damit die nächste Erinnerung ohne Aufklappen weitergeht. Der
    // conditional Render des Paneels würde es sonst unmounten, samt Serienzähler
    // und Wertübernahme (Muster: `pages/MeldungenPage.tsx`, LFH-332/B4).
    onSuccess: () => {
      invalidiere();
      message.success('Erinnerung angelegt');
    },
    onError: fehler,
  });
  /**
   * Der Rückweg beider Abschluss-Aktionen (LFH-343 · C8, Befund H50). Seit C8
   * schalten „Erledigt" und „Quittieren" mit EINEM Klick statt mit Rückfrage;
   * `POST …/erinnerungen/{eid}/oeffnen` räumt dafür alle drei Achsen — Status,
   * Vollzug und Quittung. Ohne diese Route wäre der Rückgängig-Knopf ein 422.
   */
  const oeffnenMutation = useMutation({
    mutationFn: (eid: number) => oeffneErinnerung(einsatzId, eid),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const erledigenMutation = useMutation({
    mutationFn: (eid: number) => erledigeErinnerung(einsatzId, eid),
    onSuccess: (_daten, eid) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Erinnerung erledigt', () => oeffnenMutation.mutate(eid));
    },
    onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: (eid: number) => quittiereErinnerung(einsatzId, eid),
    onSuccess: (_daten, eid) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Erinnerung quittiert', () => oeffnenMutation.mutate(eid));
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const alleErinnerungen = erinnerungenQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig ueber die gemeinsame Phasen-Semantik trennen.
  const offene = alleErinnerungen.filter(
    (e) => !istAbgeschlossen(ERINNERUNG_STATUS[e.status]?.phase ?? 'offen'),
  );
  const abgeschlossene = alleErinnerungen.filter((e) =>
    istAbgeschlossen(ERINNERUNG_STATUS[e.status]?.phase ?? 'offen'),
  );

  // Offen-Ansicht: nach Faelligkeit gruppieren, je Gruppe nach faellig_at aufsteigend.
  const offeneGruppen: { gruppe: FaelligGruppe; erinnerungen: Erinnerung[] }[] = GRUPPE_ORDNUNG.map(
    (gruppe) => ({
      gruppe,
      erinnerungen: offene
        .filter((e) => faelligGruppe(e.faellig_at, e.ist_faellig) === gruppe)
        .sort((a, b) => (a.faellig_at ?? '￿').localeCompare(b.faellig_at ?? '￿')),
    }),
  ).filter(({ erinnerungen }) => erinnerungen.length > 0);

  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
  const abgeschlosseneSortiert = [...abgeschlossene].sort((a, b) =>
    abschlussZeit(b).localeCompare(abschlussZeit(a)),
  );

  const listenProps = {
    darfSchreiben,
    onErledigen: (eid: number) => erledigenMutation.mutate(eid),
    onQuittieren: (eid: number) => quittierenMutation.mutate(eid),
  };

  return (
    <EinsatzSeite
      titel="Erinnerungen"

      meta={`${offene.length} offen · ${abgeschlossene.length} abgeschlossen`}
      dataUpdatedAt={erinnerungenQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Erinnerungen' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Button
            type="primary"
            icon={formOffen ? <UpOutlined /> : <PlusOutlined />}
            onClick={() => setFormOffen((o) => !o)}
          >
            {formOffen ? 'Formular schließen' : 'Erinnerung anlegen'}
          </Button>
        )
      }
    >
      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Erinnerung"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          }
        >
          {/* mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn die
              Erinnerung wirklich angekommen ist (LFH-332/B4). */}
          <ErinnerungFormular
            card={false}
            senden={anlegenMutation.isPending}
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
          />
        </Paneel>
      )}

      {erinnerungenQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Erinnerungen konnten nicht geladen werden"
        />
      )}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: token.marginSM,
          marginBottom: token.margin,
          alignItems: 'center',
        }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={setAnsicht}
          optionen={[
            { wert: 'offen', label: `Offen (${offene.length})` },
            { wert: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
          ]}
        />
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <ErinnerungListe erinnerungen={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ gruppe, erinnerungen }) => (
            <div key={gruppe} style={{ marginBottom: token.margin }}>
              <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
                {GRUPPE_LABEL[gruppe]} ({erinnerungen.length})
              </Augenbraue>
              <ErinnerungListe erinnerungen={erinnerungen} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <ErinnerungListe
          erinnerungen={abgeschlosseneSortiert}
          ansicht="abgeschlossen"
          {...listenProps}
        />
      )}
    </EinsatzSeite>
  );
}
