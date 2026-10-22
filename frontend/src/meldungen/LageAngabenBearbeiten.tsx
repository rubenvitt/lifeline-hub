import { App, Button, Form, Input, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { korrigiereMeldung } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { LageMeldung, MeldungKorrekturPatch } from '../api/types';
import KoordinatenFeld from '../anzeige/KoordinatenFeld';
import { alsLatLon, type KoordinatenWert } from '../anzeige/koordinatenWert';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { istLeer, lageAenderung } from './meldungKorrekturKern';

interface Props {
  einsatzId: number;
  /** Die Lagemeldung, wie die Lage sie zeigt: `text` ist der eigene Lage-Text oder der Wortlaut. */
  lage: Pick<LageMeldung, 'meldung_id' | 'meldung_lfd_nr' | 'text' | 'lat' | 'lon'>;
  /** Gespeichert, ohne Änderung bestätigt oder abgebrochen. */
  onFertig: () => void;
}

interface FormWerte {
  text: string;
  koord?: KoordinatenWert;
}

/**
 * Lage-Text und Verortung einer Meldung in der Lage nachträglich setzen, ändern oder leeren
 * (LLH-1066, design.md D6, D9): in der Zeile der Seite Lagemeldungen und im Inspector der
 * Lagekarte. Schreibt über die Korrektur der Meldung (`PATCH …/meldungen/{mid}`), also mit
 * Schreibrecht und Freigabe Meldungen; die Aufrufer zeigen den Knopf nur dann. Ein geänderter
 * Text ist für die Lage wieder neu, ein versetzter Ort nicht. Eine Ablehnung steht im Formular.
 *
 * Kartenmuster bis zum Baustein „Bearbeiten in der Ansicht“ (LLH-1022): **später auf Baustein
 * umstellen**.
 */
export default function LageAngabenBearbeiten({ einsatzId, lage, onFertig }: Props) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const speichern = useMutation({
    mutationFn: (aenderung: MeldungKorrekturPatch) =>
      korrigiereMeldung(einsatzId, lage.meldung_id, aenderung),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(einsatzId) });
      message.success(`Lage-Angaben zu Meldung #${lage.meldung_lfd_nr} gespeichert`);
      onFertig();
    },
  });

  const absenden = (w: FormWerte) => {
    const aenderung = lageAenderung(lage, { text: w.text ?? '', ort: alsLatLon(w.koord) });
    if (istLeer(aenderung)) {
      onFertig();
      return;
    }
    speichern.mutate(aenderung);
  };
  const abbrechen = () => {
    if (!speichern.isPending) onFertig();
  };

  return (
    <Form<FormWerte>
      form={form}
      layout="vertical"
      initialValues={{
        text: lage.text,
        koord: lage.lat != null && lage.lon != null ? { lat: lage.lat, lon: lage.lon } : null,
      }}
      onFinish={absenden}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          abbrechen();
        }
      }}
      aria-label={`Lage-Angaben zu Meldung #${lage.meldung_lfd_nr}`}
      style={{ width: '100%' }}
    >
      <Form.Item name="text" label="Lage-Text" rules={[zeichenRegel(ETB_INHALT_MAX, 'Lage-Text')]}>
        {/* Leer gilt der Wortlaut: der Platzhalter sagt es, wie „jetzt“ an der Ereigniszeit. */}
        <Input.TextArea
          aria-label="Lage-Text"
          rows={3}
          placeholder="Wortlaut der Meldung"
          count={zeichenGrenze(ETB_INHALT_MAX)}
        />
      </Form.Item>
      <KoordinatenFeld
        name="koord"
        label="Verortung"
        einsatzId={einsatzId}
        exclude={`lagemeldung:${lage.meldung_id}`}
      />
      {speichern.error != null && (
        <div style={{ marginBottom: 12 }}>
          <SpeicherFehler fehler={speichern.error} />
        </div>
      )}
      <Space style={{ justifyContent: 'flex-end', width: '100%' }} wrap>
        <Button onClick={abbrechen} disabled={speichern.isPending}>
          Abbrechen
        </Button>
        <Button type="primary" htmlType="submit" loading={speichern.isPending}>
          Speichern
        </Button>
      </Space>
    </Form>
  );
}
