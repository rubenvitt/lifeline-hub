import { useEffect } from 'react';
import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { einsatzKeys } from '../api/queryKeys';
import { aendereDokument, type DokumentAenderung } from '../api/dokumente';
import type { Dokument, DokumentKategorie } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';
import { bezugAusWert, bezugWert, useBezugOptionen } from './bezug';

interface Props {
  einsatzId: number;
  /** Das zu bearbeitende Dokument; gesetzt = Dialog offen. */
  dokument: Dokument | null;
  onSchliessen: () => void;
}

interface BearbeitenFormular {
  kategorie: DokumentKategorie;
  titel: string;
  /** `abschnitt:<id>` · `einheit:<id>` · `etb_eintrag:<id>` — getrennt wird beim Absenden. */
  bezug?: string;
}

/** Formularwerte → PATCH-Body. Immer alle drei Angaben; ein geleerter Bezug geht als
 *  `null`/`null`, damit der Server ihn entfernt (LFH-656, D1/D4). */
function zuAenderung(werte: BearbeitenFormular): DokumentAenderung {
  const bezug = bezugAusWert(werte.bezug);
  return {
    titel: werte.titel,
    kategorie: werte.kategorie,
    bezug_typ: bezug?.typ ?? null,
    bezug_id: bezug?.id ?? null,
  };
}

/**
 * Bearbeiten-Dialog der Dokumentenablage (LFH-656) auf der Erfassungs-Hülle.
 *
 * Drei sichtbare Felder — Kategorie, Titel, Bezug —, vorbelegt mit dem Stand des Dokuments. Ohne
 * Dateifeld passt der Bezug ins Feldbudget und steht offen: der vergessene Bezug ist einer der
 * Anlässe des Bearbeitens, und das Feld kann eine Ablehnung auslösen. Die Datei selbst ist nicht
 * änderbar; dafür bleibt Entfernen und neu Ablegen.
 *
 * Vorbelegt wird beim Öffnen per `setFieldsValue` (kein Reset im Sinne der Erfassungs-Norm).
 * Liegt der aktuelle Bezug nicht in den geladenen Optionen, ergänzt `useBezugOptionen` ihn aus
 * dem Dokument. `mutateAsync`, damit eine Ablehnung die Felder stehen lässt.
 */
export default function DokumentBearbeitenModal({ einsatzId, dokument, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<BearbeitenFormular>();
  const offen = dokument != null;

  const { optionen: bezugOptionen, etbLaedt } = useBezugOptionen(einsatzId, {
    aktiv: offen,
    etbLaden: offen,
    aktuell: dokument,
  });

  useEffect(() => {
    if (!dokument) return;
    form.setFieldsValue({
      kategorie: dokument.kategorie,
      titel: dokument.titel,
      bezug: bezugWert(dokument),
    });
  }, [dokument, form]);

  const mutation = useMutation({
    mutationFn: ({ id, aenderung }: { id: number; aenderung: DokumentAenderung }) =>
      aendereDokument(einsatzId, id, aenderung),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument geändert');
    },
  });

  function schliessen() {
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<BearbeitenFormular>
      offen={offen}
      titel="Dokument bearbeiten"
      form={form}
      onErfassen={(werte) =>
        mutation.mutateAsync({ id: dokument!.id, aenderung: zuAenderung(werte) })
      }
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Speichern"
    >
      <SpeicherFehler fehler={mutation.error} titel="Nicht geändert" />
      <Form.Item
        name="kategorie"
        label="Kategorie"
        rules={[{ required: true, message: 'Bitte eine Kategorie wählen' }]}
      >
        <Select
          options={DOKUMENT_KATEGORIE_REIHENFOLGE.map((k) => ({
            value: k,
            label: DOKUMENT_KATEGORIEN[k].label,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="titel"
        label="Titel"
        rules={[{ required: true, whitespace: true, message: 'Bitte einen Titel angeben' }]}
      >
        <Input maxLength={200} />
      </Form.Item>
      <Form.Item name="bezug" label="Bezug">
        <Select allowClear loading={etbLaedt} options={bezugOptionen} />
      </Form.Item>
    </ErfassungsModal>
  );
}
