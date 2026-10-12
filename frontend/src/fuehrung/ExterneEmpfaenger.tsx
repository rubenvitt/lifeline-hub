import { AutoComplete, Button, Col, Row, type FormRule } from 'antd';
import { AUFTRAG_EXTERN_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import type { AdressatKategorie } from '../api/types';
import { Select } from '../components/Select';
import { teilwortSuche } from '../components/teilwortSuche';
import { grenzeText, istZuLang, Zeichenzaehler } from '../components/zeichenGrenze';
import { IconMuelleimer, IconPlus } from '../icons';
import { externeStellenOptions, useExterneStellen } from '../stammdaten/externeStellenVorschlaege';
import { EXTERN_KATEGORIE_OPTIONS } from './empfaengerKern';

/**
 * Externe Stellen eines Verteilers (Change `kz5udbog-verteiler-vorlagendokument`, design.md D7):
 * je Zeile Kategorie und Bezeichnung, Vorschläge aus dem Katalog „Externe Stellen“ (LFH-1194,
 * wie Adressat der Nachforderung). Eine eigene Liste statt Tags, weil die Kategorie mitgeht —
 * Server und Schwärzung brauchen sie.
 *
 * Kontrolliert für `Form.Item`; die Prüfung trägt {@link externeEmpfaengerRule} am selben Feld.
 * Eine zu lange Bezeichnung wird nie gekürzt (LFH-937): der Zähler nennt sie, das Feld meldet sich,
 * die Regel sperrt das Senden.
 */

export interface ExternerEmpfaenger {
  /** Fehlt bei einer frisch hinzugefügten Zeile, bis jemand wählt. */
  kategorie?: AdressatKategorie;
  bezeichnung: string;
}

const BEZEICHNUNG_MAX = AUFTRAG_EXTERN_BEZEICHNUNG_MAX;

/** Regel des `Form.Item`: Überlänge und eine Bezeichnung ohne Kategorie sperren das Senden. */
export const externeEmpfaengerRule = {
  validator: (_: unknown, wert: unknown) => {
    const zeilen = Array.isArray(wert) ? (wert as ExternerEmpfaenger[]) : [];
    if (zeilen.some((z) => istZuLang(z.bezeichnung, BEZEICHNUNG_MAX))) {
      return Promise.reject(
        new Error(
          `Bezeichnung der externen Stelle darf höchstens ${grenzeText(BEZEICHNUNG_MAX)} Zeichen lang sein`,
        ),
      );
    }
    if (zeilen.some((z) => !z.kategorie && (z.bezeichnung ?? '').trim() !== '')) {
      return Promise.reject(new Error('Kategorie der externen Stelle fehlt'));
    }
    return Promise.resolve();
  },
} satisfies FormRule;

const KEINE_ZEILEN: ExternerEmpfaenger[] = [];

export function ExterneEmpfaenger({
  value = KEINE_ZEILEN,
  onChange,
  disabled,
}: {
  value?: ExternerEmpfaenger[];
  onChange?: (zeilen: ExternerEmpfaenger[]) => void;
  disabled?: boolean;
}) {
  const stellenOptionen = externeStellenOptions(useExterneStellen().data ?? []);

  const updateRow = (index: number, aenderung: Partial<ExternerEmpfaenger>) =>
    onChange?.(value.map((z, i) => (i === index ? { ...z, ...aenderung } : z)));
  const removeRow = (index: number) => onChange?.(value.filter((_, i) => i !== index));
  const addRow = () => onChange?.([...value, { bezeichnung: '' }]);

  return (
    <div>
      {value.map((zeile, index) => {
        const nummer = index + 1;
        const zuLang = istZuLang(zeile.bezeichnung, BEZEICHNUNG_MAX);
        return (
          <Row key={index} gutter={[16, 8]} align="top" style={{ marginBottom: 8 }}>
            <Col xs={24} sm={9}>
              <Select<AdressatKategorie>
                aria-label={`Kategorie externe Stelle ${nummer}`}
                placeholder="Kategorie"
                options={EXTERN_KATEGORIE_OPTIONS}
                value={zeile.kategorie}
                onChange={(kategorie) => updateRow(index, { kategorie })}
                disabled={disabled}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={20} sm={13}>
              <AutoComplete
                aria-label={`Bezeichnung externe Stelle ${nummer}`}
                aria-invalid={zuLang || undefined}
                status={zuLang ? 'error' : undefined}
                options={stellenOptionen}
                showSearch={teilwortSuche}
                placeholder="z. B. Leitstelle Nord"
                value={zeile.bezeichnung}
                onChange={(bezeichnung?: string) =>
                  updateRow(index, { bezeichnung: bezeichnung ?? '' })
                }
                disabled={disabled}
                style={{ width: '100%' }}
              />
              <Zeichenzaehler wert={zeile.bezeichnung.trim()} max={BEZEICHNUNG_MAX} />
            </Col>
            <Col xs={4} sm={2}>
              <Button
                type="text"
                danger
                aria-label={`Externe Stelle ${nummer} entfernen`}
                icon={<IconMuelleimer />}
                onClick={() => removeRow(index)}
                disabled={disabled}
              />
            </Col>
          </Row>
        );
      })}
      <Button icon={<IconPlus />} onClick={addRow} disabled={disabled}>
        Externe Stelle hinzufügen
      </Button>
    </div>
  );
}
