import { useCallback, useRef, useState } from 'react';
import { App, Button, Collapse, Form, Input, Upload, type UploadFile } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { einsatzKeys } from '../api/queryKeys';
import { legeDokumentAb, type DokumentAblage, type DokumentBezugTyp } from '../api/dokumente';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import type { DokumentKategorie } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';

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

/** So viele ETB-Einträge stehen als Bezug zur Wahl (die jüngsten). Eigener Filter im Key, damit
 *  die Abfrage nicht das Cache-Fach der Infinite-Query von `EtbPage` teilt. */
const ETB_BEZUG_DECKEL = 100;
const BEZUG_TYPEN: readonly DokumentBezugTyp[] = ['abschnitt', 'einheit', 'etb_eintrag'];
const kuerze = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Formularwerte → API-Eingabe. Rein und exportiert, damit die Präfix-Trennung ohne Render
 *  prüfbar bleibt. Ein unbekannter Präfix fällt weg, statt einen halben Bezug zu senden. */
export function zuAblage(werte: AblageFormular): DokumentAblage {
  const datei = werte.datei?.[0]?.originFileObj as File;
  const ablage: DokumentAblage = { datei, titel: werte.titel, kategorie: werte.kategorie };
  if (werte.bezug) {
    const trenner = werte.bezug.lastIndexOf(':');
    const typ = werte.bezug.slice(0, trenner) as DokumentBezugTyp;
    const id = Number(werte.bezug.slice(trenner + 1));
    if (BEZUG_TYPEN.includes(typ) && Number.isInteger(id) && id > 0) ablage.bezug = { typ, id };
  }
  return ablage;
}

/**
 * Ablegen-Dialog der Dokumentenablage (LFH-632) auf der Erfassungs-Hülle (LFH-332 · B4).
 *
 * FELDBUDGET: drei sichtbare Felder — Datei, Kategorie, Titel. Alle drei sind Pflicht und
 * stehen deshalb nie hinter dem Collapse (LFH-343 · H49). Der Bezug ist optional und liegt
 * eingeklappt, mit `forceRender`, damit die Zählung „3" nicht trivial erfüllt ist.
 *
 * Die Kategorie hat KEINE Vorbelegung: ein Foto, das als „Sonstiges" durchrutscht, findet
 * später niemand über den Filter. Der Titel wird aus dem Dateinamen vorbelegt, aber nur, wenn
 * er noch leer ist — einen getippten Titel überschreibt die Dateiwahl nicht.
 *
 * `mutateAsync`: eine Ablehnung (Dateityp, fremdes Bezugsziel → 400) muss die Felder stehen
 * lassen; die Hülle erkennt das an der abgelehnten Zusage. Der Fehlertext steht als
 * `SpeicherFehler` IM Dialog (LFH-345 · H14) — ein Toast wäre nach drei Sekunden weg, und
 * der gefüllte Dialog sähe danach aus wie „gleich fertig".
 *
 * Die ETB-Einträge lädt der Dialog erst, wenn der Bezug aufgeklappt ist: das Tagebuch ist
 * die längste Liste des Einsatzes, und die meisten Ablagen haben keinen Bezug.
 */
export default function DokumentAblegenModal({ einsatzId, offen, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();
  const [bezugOffen, setBezugOffen] = useState(false);
  /** Welcher Titel zuletzt AUTOMATISCH gesetzt wurde. Nur solange das Feld genau diesen Wert
   *  trägt, darf eine neue Dateiwahl ihn ersetzen — ein getippter Titel bleibt immer stehen. */
  const autoTitel = useRef<string | null>(null);

  /**
   * Fokus auf „Datei wählen" beim Öffnen. Die Hülle fokussiert das erste `<input>` — hier ist
   * das rc-uploads `<input type="file">` mit `display: none`, im Browser nicht fokussierbar
   * (jsdom merkt das nicht). Die Hülle bleibt unangetastet; dieser Callback-Ref hängt mit dem
   * Knopf ein und fokussiert per `requestAnimationFrame`, also NACH dem Effekt der Hülle.
   */
  const dateiKnopf = useCallback((knopf: HTMLButtonElement | null) => {
    if (knopf) requestAnimationFrame(() => knopf.focus());
  }, []);

  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: offen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: offen,
  });
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    queryFn: () => listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    enabled: offen && bezugOffen,
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

  const bezugOptionen = [
    {
      label: 'Abschnitte',
      options: (abschnitteQuery.data ?? []).map((a) => ({
        value: `abschnitt:${a.id}`,
        label: a.name,
      })),
    },
    {
      label: 'Einheiten',
      options: (einheitenQuery.data ?? []).map((e) => ({
        value: `einheit:${e.id}`,
        label: e.name,
      })),
    },
    {
      label: 'ETB-Einträge',
      options: (etbQuery.data ?? []).map((e) => ({
        value: `etb_eintrag:${e.id}`,
        label: `ETB ${e.lfd_nr} · ${kuerze(e.inhalt, 60)}`,
      })),
    },
  ];

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
      <Form.Item
        name="datei"
        label="Datei"
        valuePropName="fileList"
        getValueFromEvent={(e: { fileList?: UploadFile[] } | UploadFile[]) =>
          Array.isArray(e) ? e : e?.fileList
        }
        rules={[{ required: true, message: 'Bitte eine Datei wählen' }]}
      >
        <Upload
          beforeUpload={() => false}
          maxCount={1}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.txt,.csv,.docx,.xlsx,.pptx"
          onChange={({ file }) => {
            // Das Entfernen einer Datei ist keine Dateiwahl — der Titel bleibt.
            if (file.status === 'removed') return;
            const aktuell: string | undefined = form.getFieldValue('titel');
            if (!aktuell || aktuell === autoTitel.current) {
              const neu = file.name.replace(/\.[^.]+$/, '');
              autoTitel.current = neu;
              form.setFieldValue('titel', neu);
            }
          }}
        >
          <Button ref={dateiKnopf} icon={<UploadOutlined />}>
            Datei wählen
          </Button>
        </Upload>
      </Form.Item>
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
                <Select
                  allowClear
                  loading={bezugOffen && etbQuery.isLoading}
                  options={bezugOptionen}
                />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
