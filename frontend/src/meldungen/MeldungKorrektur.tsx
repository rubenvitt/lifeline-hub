import { Alert, Button, Col, Form, Input, Row, Space } from 'antd';
import { useState } from 'react';
import { ETB_PARTEI_MAX } from '../api/eingabegrenzen';
import type {
  Einheit,
  Einsatzabschnitt,
  Meldung,
  MeldungKorrekturPatch,
  MeldungPrioritaet,
  Meldungsart,
  Richtung,
} from '../api/types';
import { Select } from '../components/Select';
import { MELDUNGSART_OPTIONEN, PRIORITAET_OPTIONEN, RICHTUNG_OPTIONEN } from './MeldungFormular';
import {
  istLeer,
  korrekturAenderung,
  korrekturStartwerte,
  type KorrekturWerte,
  wirdHeraufgestuft,
} from './meldungKorrekturKern';

/** Auswahl des Von-Bezugs, gruppiert wie im Erfassen: `einheit:<id>` / `abschnitt:<id>`. */
export interface VonGruppe {
  label: string;
  options: { value: string; label: string }[];
}

/** Die Von-Auswahl aus Einheiten und Abschnitten des Einsatzes; leere Gruppen entfallen. */
export function vonOptionenAus(
  einheiten: Pick<Einheit, 'id' | 'name'>[] = [],
  abschnitte: Pick<Einsatzabschnitt, 'id' | 'name'>[] = [],
): VonGruppe[] {
  return [
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
    },
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
    },
  ].filter((g) => g.options.length > 0);
}

interface Props {
  meldung: Meldung;
  vonOptionen?: VonGruppe[];
  /**
   * Speichern der Änderung. **Muss bei Ablehnung ablehnen** (`mutateAsync`): nur dann bleibt die
   * Bearbeitung offen; den Grund zeigt die Karte (`ZeilenFehler`).
   */
  onSpeichern: (aenderung: MeldungKorrekturPatch) => Promise<unknown>;
  /** Gespeichert, ohne Änderung bestätigt oder abgebrochen: die Karte schließt die Bearbeitung. */
  onFertig: () => void;
}

/**
 * Korrektur einer Meldung an ihrer Karte (LLH-1066, design.md D9): Art, Priorität, Richtung, Von
 * und Empfänger. Wortlaut, Absender, Meldeweg und Ereigniszeit bleiben, wie die Meldung einging,
 * und stehen deshalb nicht im Formular. Gesendet wird nur, was sich geändert hat.
 *
 * Kartenmuster bis zum Baustein „Bearbeiten in der Ansicht“ (LLH-1022): **später auf Baustein
 * umstellen** (Bearbeiten-Zustand, Verlassen-Schutz, CAS).
 */
export default function MeldungKorrektur({
  meldung,
  vonOptionen = [],
  onSpeichern,
  onFertig,
}: Props) {
  const [form] = Form.useForm<KorrekturWerte>();
  const [sendet, setSendet] = useState(false);
  const meldungsart = Form.useWatch('meldungsart', form) ?? meldung.meldungsart;
  const prioritaet = Form.useWatch('prioritaet', form) ?? meldung.prioritaet;
  const heraufgestuft = wirdHeraufgestuft(meldung, { meldungsart, prioritaet });

  const absenden = (w: KorrekturWerte) => {
    const aenderung = korrekturAenderung(meldung, w);
    if (istLeer(aenderung)) {
      onFertig();
      return;
    }
    setSendet(true);
    onSpeichern(aenderung).then(
      () => {
        setSendet(false);
        onFertig();
      },
      // Abgelehnt: die Bearbeitung bleibt offen, den Grund zeigt die Karte.
      () => setSendet(false),
    );
  };

  const abbrechen = () => {
    if (!sendet) onFertig();
  };

  return (
    <Form<KorrekturWerte>
      form={form}
      layout="vertical"
      initialValues={korrekturStartwerte(meldung)}
      onFinish={absenden}
      onKeyDown={(e) => {
        // Escape bricht ab, wie an jeder Bearbeitung in der Ansicht.
        if (e.key === 'Escape') {
          e.stopPropagation();
          abbrechen();
        }
      }}
      aria-label={`Meldung #${meldung.lfd_nr} korrigieren`}
      style={{ marginTop: 8 }}
    >
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="meldungsart" label="Meldungsart">
            <Select<Meldungsart> aria-label="Meldungsart" options={MELDUNGSART_OPTIONEN} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="prioritaet" label="Priorität">
            <Select<MeldungPrioritaet> aria-label="Priorität" options={PRIORITAET_OPTIONEN} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="richtung" label="Richtung">
            <Select<Richtung> aria-label="Richtung" options={RICHTUNG_OPTIONEN} />
          </Form.Item>
        </Col>
        {vonOptionen.length > 0 && (
          <Col xs={24} sm={12}>
            <Form.Item name="von" label="Von Einheit / Abschnitt">
              <Select<string>
                aria-label="Von Einheit / Abschnitt"
                allowClear
                placeholder="nicht zugeordnet"
                options={vonOptionen}
              />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} sm={12}>
          <Form.Item name="empfaenger" label="Empfänger / Adressat">
            <Input aria-label="Empfänger / Adressat" maxLength={ETB_PARTEI_MAX} />
          </Form.Item>
        </Col>
      </Row>
      {heraufgestuft && (
        // Ein Satz zur Folge vor dem Speichern (LLH-1380): der Alarm geht an alle im Modul.
        <Alert
          type="warning"
          showIcon
          title="Speichern löst den Sofortalarm aus, wenn die Meldung noch keinen hatte."
          style={{ marginBottom: 12 }}
        />
      )}
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button onClick={abbrechen} disabled={sendet}>
          Abbrechen
        </Button>
        <Button type="primary" htmlType="submit" loading={sendet}>
          Speichern
        </Button>
      </Space>
    </Form>
  );
}
