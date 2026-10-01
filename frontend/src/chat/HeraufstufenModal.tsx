import { Checkbox, Form, Input, Typography } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { ErfassungsModal } from '../components/Erfassung';
import { ETB_ANHAENGE_MAX } from '../api/etb';
import { formatGroesse } from '../karten/formatGroesse';
import type { ChatNachricht, EtbTyp } from '../api/types';

/** Für die Heraufstufung zulässige ETB-Typen (Server erzwingt dieselbe Allowlist). */
const TYP_OPTIONEN: { value: EtbTyp; label: string }[] = [
  { value: 'meldung', label: 'Meldung' },
  { value: 'anordnung', label: 'Anordnung' },
  { value: 'lage', label: 'Lage' },
  { value: 'entscheidung', label: 'Entscheidung' },
];

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
  anhang_ids: number[];
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  onAbbrechen: () => void;
  /** Heraufstufen. Muss bei Ablehnung ablehnen (`mutateAsync`), sonst leert die Hülle. */
  onHeraufstufen: (typ: EtbTyp, inhalt: string, anhangIds: number[]) => Promise<unknown>;
}

/**
 * Heraufstufung Chat-Nachricht → ETB-Eintrag, auf der Erfassungshülle (`frontend/AGENTS.md`,
 * Erfassungs-Norm).
 *
 * LFH-700: Trägt die Nachricht Anhänge, wählt die Person, welche als Kopie ins Tagebuch gehen.
 * Vorgewählt sind die ersten {@link ETB_ANHAENGE_MAX} nach id, mehr nimmt der Server nicht. Die
 * Auswahl ist nötig, weil das ETB unveränderlich ist: Eine falsch übernommene Datei bleibt bis zur
 * Schwärzung am Eintrag (`openspec/changes/lfh-700-heraufstufen-anhaenge/design.md` D2/D6).
 */
export default function HeraufstufenModal({
  offen,
  nachricht,
  senden,
  onAbbrechen,
  onHeraufstufen,
}: Props) {
  const [form] = Form.useForm<FormWerte>();
  const anhaenge = [...(nachricht?.anhaenge ?? [])].sort((a, b) => a.id - b.id);
  const gewaehlt = Form.useWatch('anhang_ids', form) ?? [];
  const voll = gewaehlt.length >= ETB_ANHAENGE_MAX;

  // VORBELEGUNG, kein Zurücksetzen: Zurückgesetzt wird von der Hülle auf jedem Weg hinaus.
  useEffect(() => {
    if (!offen || !nachricht) return;
    form.setFieldsValue({
      typ: 'meldung',
      inhalt: nachricht.inhalt ?? '',
      anhang_ids: [...nachricht.anhaenge]
        .map((a) => a.id)
        .sort((a, b) => a - b)
        .slice(0, ETB_ANHAENGE_MAX),
    });
  }, [offen, nachricht, form]);

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Zu ETB heraufstufen"
      form={form}
      erfassenText="Heraufstufen"
      laeuft={senden}
      onErfassen={(w) => onHeraufstufen(w.typ, w.inhalt.trim(), w.anhang_ids ?? [])}
      onFertig={onAbbrechen}
      onAbbrechen={onAbbrechen}
    >
      <Form.Item label="ETB-Typ" name="typ" rules={[{ required: true }]}>
        <Select options={TYP_OPTIONEN} />
      </Form.Item>
      <Form.Item
        label="Text"
        name="inhalt"
        rules={[{ required: true, whitespace: true, message: 'Text erforderlich' }]}
      >
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
      </Form.Item>
      {anhaenge.length > 0 && (
        <Form.Item
          label="Anhänge übernehmen"
          name="anhang_ids"
          extra="Übernommene Dateien werden kopiert und sind im Tagebuch unveränderlich."
          rules={[
            {
              type: 'array',
              max: ETB_ANHAENGE_MAX,
              message: `Höchstens ${ETB_ANHAENGE_MAX} Anhänge je Eintrag`,
            },
          ]}
        >
          <Checkbox.Group
            role="group"
            aria-label="Anhänge übernehmen"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {anhaenge.map((a) => (
              <Checkbox
                key={a.id}
                value={a.id}
                // Die Grenze zeigt sich am Kästchen, nicht erst als Fehler beim Absenden.
                disabled={voll && !gewaehlt.includes(a.id)}
              >
                {a.dateiname}{' '}
                <Typography.Text type="secondary">· {formatGroesse(a.groesse)}</Typography.Text>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>
      )}
    </ErfassungsModal>
  );
}
