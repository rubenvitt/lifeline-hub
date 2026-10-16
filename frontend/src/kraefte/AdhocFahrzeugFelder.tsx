import { Collapse, Form, Input, Space, Typography } from 'antd';
import { FAHRZEUG_ADHOC_TEXT_MAX } from '../api/eingabegrenzen';
import type { AdhocEingabe } from '../api/einsatzFahrzeuge';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import type { AdhocFeld } from './fahrzeugAngaben';

const ETIKETT: Record<AdhocFeld, string> = {
  funkrufname: 'Funkrufname',
  fahrzeugtyp: 'Fahrzeugtyp',
  traegerorganisation: 'Trägerorganisation',
  kennzeichen: 'Kennzeichen',
  opta: 'OPTA',
};

const PLATZHALTER: Partial<Record<AdhocFeld, string>> = {
  funkrufname: 'z. B. Florian Nachbarstadt 44/1',
  traegerorganisation: 'z. B. Feuerwehr Nachbarstadt',
};

const WEITERE_ANGABEN = 'weitere';

const ALLE_FELDER = Object.keys(ETIKETT) as AdhocFeld[];

export interface AdhocFahrzeugFelderProps {
  /**
   * Die Felder dieser Maske, in dieser Folge; Vorgabe alle fünf. „Eintreffen buchen“ (LLH-1075)
   * nimmt nur Funkrufname, Trägerorganisation und Fahrzeugtyp.
   */
  felder?: readonly AdhocFeld[];
  /** Felder unter „Weitere Angaben“, in dieser Folge; die übrigen stehen sichtbar davor. Leer:
   *  kein Klappteil. */
  weitere: readonly AdhocFeld[];
  /** Klappteil offen? Kontrolliert, damit ein Prüffehler darin ihn öffnen kann. */
  weitereOffen: boolean;
  onWeitereOffen: (offen: boolean) => void;
}

/**
 * Der Feldsatz eines Ad-hoc-Fahrzeugs (LLH-1073, design.md D7), geteilt vom Disponieren
 * (Schnellerfassung, vier sichtbar) und vom Dialog „Angaben ändern“ (Modal, drei sichtbar). Grenze
 * und Zähler je Feld aus dem Spiegel (`FAHRZEUG_ADHOC_TEXT_MAX`); ein vorbelegter Altwert über der
 * Grenze bleibt stehen und sperrt das Senden (`zeichenRegel`), gekürzt wird nie.
 *
 * `forceRender` am Klappteil: das eingeklappte Feld bleibt im Baum, damit ein eingetragener und
 * wieder zugeklappter Wert beim Absenden mitgeht und das Feld für Tastatur und Prüfung existiert.
 * Der Kopf nennt die gesetzten Werte (Ausnahme LFH-974 der Erfassungs-Norm): ein Wert hinter einem
 * geschlossenen Kopf wäre sonst unsichtbar.
 */
export default function AdhocFahrzeugFelder({
  felder = ALLE_FELDER,
  weitere,
  weitereOffen,
  onWeitereOffen,
}: AdhocFahrzeugFelderProps) {
  const form = Form.useFormInstance<AdhocEingabe>();
  const werte = Form.useWatch([], form) as Partial<AdhocEingabe> | undefined;
  const sichtbar = felder.filter((f) => !weitere.includes(f));
  const feld = (f: AdhocFeld) => (
    <Form.Item
      key={f}
      label={ETIKETT[f]}
      name={f}
      rules={[
        ...(f === 'funkrufname' ? [{ required: true, whitespace: true }] : []),
        zeichenRegel(FAHRZEUG_ADHOC_TEXT_MAX, ETIKETT[f]),
      ]}
    >
      <Input placeholder={PLATZHALTER[f]} count={zeichenGrenze(FAHRZEUG_ADHOC_TEXT_MAX)} />
    </Form.Item>
  );
  const gesetzt = weitere
    .map((f) => [f, werte?.[f]?.trim()] as const)
    .filter(([, w]) => !!w)
    .map(([f, w]) => `${ETIKETT[f]} ${w}`);
  return (
    <>
      {sichtbar.map(feld)}
      {weitere.length > 0 && (
        <Collapse
          ghost
          activeKey={weitereOffen ? [WEITERE_ANGABEN] : []}
          onChange={(keys) => onWeitereOffen((Array.isArray(keys) ? keys : [keys]).length > 0)}
          items={[
            {
              key: WEITERE_ANGABEN,
              label: (
                <Space size={4} wrap>
                  <span>Weitere Angaben</span>
                  {gesetzt.length > 0 && (
                    <Typography.Text type="secondary" data-lfh="weitere-angaben-werte">
                      · {gesetzt.join(', ')}
                    </Typography.Text>
                  )}
                </Space>
              ),
              forceRender: true,
              children: weitere.map(feld),
            },
          ]}
        />
      )}
    </>
  );
}
