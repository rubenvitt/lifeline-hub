import { Collapse, Form, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import type { EinsatzRolle } from '../api/types';
import { loadMitgliedAuswahlAnlage } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { anzahl } from '../anzeige/anzahl';
import { Select } from '../components/Select';
import { Feld, useRollen } from '../components/instrument';
import { EINSATZ_ROLLE_OPTIONEN } from '../einsatz/einsatzRolle';
import { rollenOptionRender } from '../einsatz/rollenOption';
import { pflicht } from '../components/pflichtRegel';

/** Eine Person, die mit dem Einsatz gleich aufgenommen wird (LLH-1820). */
export interface AnlageMitglied {
  benutzer_id: number;
  rolle: EinsatzRolle;
}

/** Schlüssel des Klappteils; nicht `mitglieder`, das ist ein Einsatz-Query-Key. */
const KLAPP_KEY = 'anlage-personen';

/** Rolle einer neu gewählten Person (Design-Doc LLH-1820, „Dialog“). */
const VORGABE_ROLLE: EinsatzRolle = 'fuehrungspersonal';

/**
 * Kopf des Teils: er nennt die Wahl immer, auch zugeklappt (`frontend/AGENTS.md`, Feldbudget,
 * Klappteil-Ausnahme). „Einsatzleitung“ ist die anlegende Person; sie zählt nicht mit. Ohne Du
 * (`frontend/AGENTS.md`, „Anrede“).
 */
export function mitgliederKopf(gewaehlt: number): string {
  const wahl =
    gewaehlt === 0
      ? 'nur Einsatzleitung'
      : `Einsatzleitung + ${anzahl(gewaehlt, 'Person', 'Personen')}`;
  return `Mitglieder · ${wahl}`;
}

/** Neue Liste nach einer Wahl im Personenfeld: Gebliebene behalten ihre Rolle. */
export function nachPersonenwahl(bisher: AnlageMitglied[], ids: number[]): AnlageMitglied[] {
  const nachId = new Map(bisher.map((m) => [m.benutzer_id, m]));
  return ids.map((id) => nachId.get(id) ?? { benutzer_id: id, rolle: VORGABE_ROLLE });
}

interface Props {
  offen: boolean;
  onOffenChange: (offen: boolean) => void;
}

/**
 * Eingeklappter Teil „Mitglieder“ im Dialog „Neuen Einsatz anlegen“ (LLH-1820). Formularfeld
 * `mitglieder`; `forceRender`, damit Prüfung und Zurücksetzen es auch zugeklappt erreichen. Die
 * Auswahl lädt erst beim Aufklappen. Scheitert die Prüfung darin, öffnet der Dialog den Teil über
 * `onPruefungGescheitert`; eine Ablehnung des Servers steht in seiner Fehlerzeile.
 */
export default function MitgliederKlappteil({ offen, onOffenChange }: Props) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const form = Form.useFormInstance();
  const personenId = useId();
  const gewaehlt = (Form.useWatch('mitglieder', form) as AnlageMitglied[] | undefined) ?? [];
  const {
    data: auswahl = [],
    isError,
    isFetching,
  } = useQuery({
    queryKey: globalKeys.mitgliedAuswahlAnlage(),
    queryFn: loadMitgliedAuswahlAnlage,
    enabled: offen,
  });
  const namen = new Map(auswahl.map((a) => [a.benutzer_id, a.anzeigename]));
  const nameVon = (id: number) => namen.get(id) ?? `Person ${id}`;

  return (
    <Collapse
      ghost
      style={{ marginInline: -token.paddingSM }}
      activeKey={offen ? [KLAPP_KEY] : []}
      onChange={(k) => onOffenChange(k.includes(KLAPP_KEY))}
      items={[
        {
          key: KLAPP_KEY,
          forceRender: true,
          label: <span data-lfh="anlage-mitglieder-kopf">{mitgliederKopf(gewaehlt.length)}</span>,
          children: (
            <>
              <Feld label="Personen" htmlFor={personenId}>
                <Select<number[]>
                  id={personenId}
                  aria-label="Personen"
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  placeholder="Name suchen"
                  loading={isFetching}
                  notFoundContent={isError ? 'Personen nicht geladen' : undefined}
                  value={gewaehlt.map((m) => m.benutzer_id)}
                  options={auswahl.map((a) => ({ value: a.benutzer_id, label: a.anzeigename }))}
                  onChange={(ids) =>
                    form.setFieldValue('mitglieder', nachPersonenwahl(gewaehlt, ids))
                  }
                />
              </Feld>
              <div style={{ marginBlockEnd: token.margin, color: rollen.gedaempft }}>
                Eigene Rolle: Einsatzleitung
              </div>
              <Form.List name="mitglieder">
                {(felder) =>
                  felder.map((f) => {
                    const name = nameVon(gewaehlt[f.name]?.benutzer_id ?? -1);
                    return (
                      <div key={f.key}>
                        {/* Ohne eingetragenes Feld fiele die Kennung aus Werten und Rumpf. */}
                        <Feld name={[f.name, 'benutzer_id']} hidden noStyle />
                        <Feld
                          name={[f.name, 'rolle']}
                          label={name}
                          breite="mittel"
                          rules={[pflicht('Rolle')]}
                        >
                          <Select<EinsatzRolle>
                            aria-label={`Rolle von ${name}`}
                            options={EINSATZ_ROLLE_OPTIONEN}
                            optionRender={rollenOptionRender}
                          />
                        </Feld>
                      </div>
                    );
                  })
                }
              </Form.List>
            </>
          ),
        },
      ]}
    />
  );
}
