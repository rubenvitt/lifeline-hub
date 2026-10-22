import { Button, Col, Form, Input, Row, Space } from 'antd';
import { useState } from 'react';
import { ETB_PARTEI_MAX } from '../api/eingabegrenzen';
import type {
  Einheit,
  Einsatzabschnitt,
  Fuehrungsfunktion,
  Meldung,
  MeldungKorrekturPatch,
  MeldungPrioritaet,
  Meldungsart,
  Richtung,
} from '../api/types';
import { Select } from '../components/Select';
import { MELDUNGSART_OPTIONEN, PRIORITAET_OPTIONEN, RICHTUNG_OPTIONEN } from './MeldungFormular';
import {
  angeboteneWerte,
  istLeer,
  korrekturAenderung,
  korrekturStartwerte,
  type KorrekturWerte,
} from './meldungKorrekturKern';

/** Auswahl des Von-Bezugs, gruppiert wie im Erfassen: `einheit:<id>` / `abschnitt:<id>`. */
export interface VonGruppe {
  label: string;
  options: { value: string; label: string }[];
}

/** Auswahl der Empfängerfunktion, wie `meldungsFunktionsOptionen` sie baut. */
export type FunktionsAuswahl = { value: Fuehrungsfunktion; label: string }[];

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
   * Auswahl der Empfängerfunktion (LLH-1381, `meldungsFunktionsOptionen`). Leer ⇒ das Feld
   * entfällt, wie im Erfassen.
   */
  funktionsOptionen?: FunktionsAuswahl;
  /**
   * Speichern der Änderung. **Muss bei Ablehnung ablehnen** (`mutateAsync`): nur dann bleibt die
   * Bearbeitung offen; den Grund zeigt die Karte (`ZeilenFehler`).
   */
  onSpeichern: (aenderung: MeldungKorrekturPatch) => Promise<unknown>;
  /** Gespeichert, ohne Änderung bestätigt oder abgebrochen: die Karte schließt die Bearbeitung. */
  onFertig: () => void;
}

/**
 * Korrektur einer Meldung an ihrer Karte (LLH-1066, design.md D9): Art, Priorität, Richtung, Von,
 * Empfängerfunktion (LLH-1381) und Empfänger. Wortlaut, Absender, Meldeweg und Ereigniszeit bleiben, wie die Meldung einging,
 * und stehen deshalb nicht im Formular. Gesendet wird nur, was sich geändert hat.
 *
 * Kartenmuster bis zum Baustein „Bearbeiten in der Ansicht“ (LLH-1022): **später auf Baustein
 * umstellen** (Bearbeiten-Zustand, Verlassen-Schutz, CAS).
 */
export default function MeldungKorrektur({
  meldung,
  vonOptionen = [],
  funktionsOptionen = [],
  onSpeichern,
  onFertig,
}: Props) {
  const [form] = Form.useForm<KorrekturWerte>();
  const [sendet, setSendet] = useState(false);

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
            <Select<Meldungsart>
              aria-label="Meldungsart"
              options={angeboteneWerte(MELDUNGSART_OPTIONEN, 'sofortmeldung', meldung)}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="prioritaet" label="Priorität">
            <Select<MeldungPrioritaet>
              aria-label="Priorität"
              options={angeboteneWerte(PRIORITAET_OPTIONEN, 'sofort', meldung)}
            />
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
        {funktionsOptionen.length > 0 && (
          // Bleibt die Meldung „Neu“, geht ihr Hinweis an die neue Funktion (LLH-1381). Anders als
          // im Erfassen füllt die Wahl den Empfänger nicht vor: die Korrektur ändert nur, was man
          // ändert.
          <Col xs={24} sm={12}>
            <Form.Item name="empfaenger_funktion" label="Empfängerfunktion">
              <Select<Fuehrungsfunktion>
                aria-label="Empfängerfunktion"
                allowClear
                placeholder="keine"
                options={funktionsOptionen}
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
