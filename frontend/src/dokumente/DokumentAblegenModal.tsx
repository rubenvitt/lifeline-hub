import { useRef, useState } from 'react';
import { App, Collapse, Form, Input, type UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { einsatzKeys } from '../api/queryKeys';
import DateiFeld from '../components/DateiFeld';
import { DOKUMENT_ACCEPT, legeDokumentAb, type DokumentAblage } from '../api/dokumente';
import type { DokumentKategorie } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';
import { bezugAusWert, useBezugOptionen } from './bezug';

interface Props {
  einsatzId: number;
  offen: boolean;
  onSchliessen: () => void;
}

interface AblageFormular {
  datei?: UploadFile[];
  kategorie: DokumentKategorie;
  titel: string;
  /** `abschnitt:<id>` · `einheit:<id>` · `etb_eintrag:<id>` — getrennt wird beim Absenden. */
  bezug?: string;
}

/** Formularwerte → API-Eingabe. */
function zuAblage(werte: AblageFormular): DokumentAblage {
  const datei = werte.datei?.[0]?.originFileObj as File;
  const ablage: DokumentAblage = { datei, titel: werte.titel, kategorie: werte.kategorie };
  const bezug = bezugAusWert(werte.bezug);
  if (bezug) ablage.bezug = bezug;
  return ablage;
}

/**
 * Ablegen-Dialog der Dokumentenablage auf der Erfassungs-Hülle.
 *
 * Drei sichtbare Pflichtfelder — Datei, Kategorie, Titel. Der optionale Bezug liegt
 * eingeklappt mit `forceRender`. Die Kategorie hat KEINE Vorbelegung: ein Foto, das als
 * „Sonstiges" durchrutscht, findet später niemand. Der Titel wird aus dem Dateinamen
 * vorbelegt, überschreibt aber keinen getippten Titel.
 *
 * `mutateAsync`, damit eine Ablehnung die Felder stehen lässt; der Fehler steht als
 * `SpeicherFehler` im Dialog. Die ETB-Einträge lädt der Dialog erst beim Aufklappen des Bezugs.
 */
export default function DokumentAblegenModal({ einsatzId, offen, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();
  const [bezugOffen, setBezugOffen] = useState(false);
  /** Welcher Titel zuletzt AUTOMATISCH gesetzt wurde. Nur solange das Feld genau diesen Wert
   *  trägt, darf eine neue Dateiwahl ihn ersetzen — ein getippter Titel bleibt immer stehen. */
  const autoTitel = useRef<string | null>(null);

  const { optionen: bezugOptionen, etbLaedt } = useBezugOptionen(einsatzId, {
    aktiv: offen,
    etbLaden: bezugOffen,
  });

  const mutation = useMutation({
    mutationFn: (eingabe: DokumentAblage) => legeDokumentAb(einsatzId, eingabe),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument abgelegt');
    },
  });

  function schliessen() {
    setBezugOffen(false);
    autoTitel.current = null;
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<AblageFormular>
      offen={offen}
      titel="Dokument ablegen"
      form={form}
      onErfassen={(werte) => mutation.mutateAsync(zuAblage(werte))}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Ablegen"
    >
      <SpeicherFehler fehler={mutation.error} titel="Nicht abgelegt" />
      {/* Dateifeld samt Vorab-Größenprüfung und Anfangsfokus: `components/DateiFeld`. */}
      <DateiFeld
        accept={DOKUMENT_ACCEPT}
        onDateiWahl={(file) => {
          const aktuell: string | undefined = form.getFieldValue('titel');
          if (!aktuell || aktuell === autoTitel.current) {
            const neu = file.name.replace(/\.[^.]+$/, '');
            autoTitel.current = neu;
            form.setFieldValue('titel', neu);
          }
        }}
      />
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
      <Collapse
        activeKey={bezugOffen ? ['bezug'] : []}
        onChange={(schluessel) => setBezugOffen(schluessel.includes('bezug'))}
        items={[
          {
            key: 'bezug',
            label: 'Bezug (optional)',
            forceRender: true,
            children: (
              <Form.Item name="bezug" label="Bezug">
                <Select allowClear loading={etbLaedt} options={bezugOptionen} />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
