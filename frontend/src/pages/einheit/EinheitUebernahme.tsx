import { App, Button, Form, Popconfirm, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { uebernehmeEinheit, weiseEinheitAb } from '../../api/einheiten';
import { EINSATZ_KEYS, einsatzKeys } from '../../api/queryKeys';
import type { Einheit, Einsatzabschnitt, UebernahmeBody } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { ErfassungsModal } from '../../components/Erfassung';
import { Paneel, useRollen } from '../../components/instrument';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { collectNachfahren } from './einheitAnsichtKern';

interface UebernahmeWerte {
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
}

export interface EinheitUebernahmeProps {
  einsatzId: number;
  /** Eine Einheit mit offener Übernahme (`nicht_uebernommen_seit`). */
  einheit: Einheit;
  /** Alle Einheiten des Einsatzes: Angebot der Über-Einheit. */
  einheiten: readonly Einheit[];
  abschnitte: readonly Einsatzabschnitt[] | undefined;
  /** Abweisen entlässt die Fahrzeuge: zusätzlich Freigabe Fahrzeuge. */
  canAbweisen: boolean;
  /** Nach dem Abweisen; die Einheit-Ansicht führt zur Gliederung. */
  onAbgewiesen?: () => void;
  /** Nur die Knopfreihe, ohne Paneel (Meldungskarte). */
  kompakt?: boolean;
}

/**
 * Übernehmen oder Abweisen einer unangemeldet eingetroffenen Einheit (LLH-1075, design.md D14).
 * In der Einheit-Ansicht als Paneel unter dem Kopf, an der Meldung als Knopfreihe. Nur mit Recht
 * Einheiten eingehängt; der Aufrufer entscheidet. „Abweisen“ ist unumkehrbar: rote Rückfrage mit
 * dem einen Satz zur Folge. Ablehnungen stehen am Ort, kein Toast.
 */
export default function EinheitUebernahme({
  einsatzId,
  einheit,
  einheiten,
  abschnitte,
  canAbweisen,
  onAbgewiesen,
  kompakt = false,
}: EinheitUebernahmeProps) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const [form] = Form.useForm<UebernahmeWerte>();
  const [offen, setOffen] = useState(false);

  function invalidate() {
    for (const key of [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.meldungen(einsatzId),
      einsatzKeys.etb(einsatzId),
      einsatzKeys.br(einsatzId),
      [EINSATZ_KEYS.brDetail, einsatzId],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  }

  const uebernahme = useMutation({
    mutationFn: (body: UebernahmeBody) => uebernehmeEinheit(einsatzId, einheit.id, body),
    onSuccess: (neu) => {
      qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(einsatzId), (alt) =>
        alt?.map((x) => (x.id === neu.id ? neu : x)),
      );
      message.success(`${einheit.name} übernommen`);
      invalidate();
    },
  });
  const abweisen = useMutation({
    mutationFn: () => weiseEinheitAb(einsatzId, einheit.id),
    onSuccess: () => {
      message.success(`${einheit.name} abgewiesen`);
      onAbgewiesen?.();
      invalidate();
    },
  });

  const nachfahren = collectNachfahren(einheiten, einheit.id);
  const ueberOptionen = einheiten
    .filter((x) => !nachfahren.has(x.id) && x.aufgeloest_at == null)
    .map((x) => ({ value: x.id, label: x.name }));

  const reihe = (
    <Space size="middle" wrap>
      <Button
        type="primary"
        onClick={() => {
          abweisen.reset();
          setOffen(true);
        }}
      >
        Übernehmen
      </Button>
      {canAbweisen && (
        <Popconfirm
          title="Einheit abweisen?"
          description="Die Einheit verlässt den Bereitstellungsraum und wird aufgelöst, ihre Fahrzeuge werden entlassen."
          okText="Abweisen"
          okButtonProps={{ danger: true }}
          onConfirm={() => abweisen.mutate()}
        >
          <Button danger loading={abweisen.isPending}>
            Abweisen
          </Button>
        </Popconfirm>
      )}
    </Space>
  );

  const inhalt = (
    <>
      {abweisen.error != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler
            fehler={abweisen.error}
            titel="Nicht abgewiesen"
            fallback="Abweisen fehlgeschlagen"
          />
        </div>
      )}
      {reihe}
      <ErfassungsModal<UebernahmeWerte>
        offen={offen}
        titel={`${einheit.name} übernehmen`}
        form={form}
        erfassenText="Übernehmen"
        speicherung={uebernahme}
        speicherFehlerTitel="Nicht übernommen"
        speicherFehlerFallback="Übernehmen fehlgeschlagen"
        onErfassen={(w) =>
          uebernahme.mutateAsync({
            ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
            ...(w.ueber_einheit_id != null ? { ueber_einheit_id: w.ueber_einheit_id } : {}),
          })
        }
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
      >
        <Form.Item label="Abschnitt" name="abschnitt_id">
          <Select<number>
            allowClear
            placeholder="ohne Abschnitt"
            options={(abschnitte ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
        <Form.Item label="Über-Einheit" name="ueber_einheit_id">
          <Select<number> allowClear placeholder="keine" options={ueberOptionen} />
        </Form.Item>
      </ErfassungsModal>
    </>
  );

  if (kompakt) return <div data-lfh="einheit-uebernahme">{inhalt}</div>;
  return (
    <Paneel
      titel="Übernahme"
      meta={
        einheit.nicht_uebernommen_seit
          ? `eingetroffen ${formatZeitKurz(einheit.nicht_uebernommen_seit)}`
          : undefined
      }
      koerperPolster
    >
      <div data-lfh="einheit-uebernahme">{inhalt}</div>
    </Paneel>
  );
}
