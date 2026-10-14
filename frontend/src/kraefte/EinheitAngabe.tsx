import type { ReactNode } from 'react';
import { Space } from 'antd';
import { InlineAngabe } from '../components/InlineAngabe';
import { Select } from '../components/Select';
import { groupEinheitOptions, type EinheitOption } from './kraeftebaumKern';

export interface EinheitAngabeProps {
  /** Zeilenkennung für die zugänglichen Namen in einer Liste („Einheit zu Anna“). */
  kennung?: string;
  /** Gespeicherte Einheit (Serverstand); `null` = keine. */
  wert: number | null;
  /** Wählbare Einheiten in Baumfolge mit Pfad und Abschnitt (`buildEinheitOptions`). */
  optionen: readonly EinheitOption[];
  darfSchreiben: boolean;
  /** Zusatz hinter dem Namen, etwa die Marke „Einheitsführer“. */
  marke?: ReactNode;
  /**
   * Übernahme mit neuem UND bisherigem Wert: den Endpunkt wählt der Aufrufer (Zuordnung einer
   * Person, eines Fahrzeugs, eines Materials). Lehnt bei Ablehnung ab, dann bleibt die Auswahl mit
   * dem gewählten Wert offen und der Grund steht an ihr. Erfüllt erst, wenn der neue Wert im Cache
   * steht.
   */
  onSpeichern: (neu: number | null, alt: number | null) => Promise<unknown>;
}

/**
 * Einheit als Inline-Angabe (LLH-1073 D3, geteilt mit LLH-1060/1093): wählen, dann „Speichern“;
 * kein Speichern beim Verlassen, denn ein Fehlgriff schriebe sofort einen ETB-Eintrag. Unverändert
 * sendet nichts (`InlineAngabe`). Die Auswahl zeigt den Pfad („Zug 1 › Staffel A“), gruppiert nach
 * dem Abschnitt der Einheit (`groupEinheitOptions`, „ohne Abschnitt“ zuletzt; ohne jeden
 * Abschnitt flach); der Wert zeigt den Namen. Ohne Schreibrecht steht der Name als Text.
 *
 * Eine Einheit, die nicht in `optionen` steht (Liste noch alt), zeigt kein erfundenes Etikett.
 */
export default function EinheitAngabe({
  kennung,
  wert,
  optionen,
  darfSchreiben,
  marke,
  onSpeichern,
}: EinheitAngabeProps) {
  const aktuell = wert != null ? optionen.find((o) => o.id === wert) : undefined;
  const name = aktuell?.name ?? 'nicht geladen';
  const option = (o: EinheitOption) => ({ value: o.id, label: o.pfad });
  const gruppen = groupEinheitOptions(optionen);
  const auswahl =
    gruppen.length > 0
      ? gruppen.map((g) => ({
          key: g.schluessel,
          label: g.titel,
          title: g.titel,
          options: g.optionen.map(option),
        }))
      : optionen.map(option);
  return (
    <InlineAngabe<number | null>
      etikett="Einheit"
      kennung={kennung}
      wert={wert}
      anzeige={
        marke ? (
          <Space size={4} wrap>
            {name}
            {marke}
          </Space>
        ) : (
          name
        )
      }
      leer={(w) => w == null}
      darfSchreiben={darfSchreiben}
      onSpeichern={(neu) => onSpeichern(neu, wert)}
      eingabe={({ feld, value, onChange, popup }) => (
        <Select<number | null>
          {...feld}
          {...popup}
          value={value ?? undefined}
          allowClear
          placeholder="ohne Einheit"
          onChange={(v) => onChange(v ?? null)}
          options={auswahl}
          popupMatchSelectWidth={false}
          style={{ width: '100%', minWidth: 0 }}
        />
      )}
    />
  );
}
