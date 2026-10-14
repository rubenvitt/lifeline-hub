import type { ReactNode } from 'react';
import { Space } from 'antd';
import { InlineAngabe } from '../components/InlineAngabe';
import { Select } from '../components/Select';
import type { EinheitOption } from './einheitAngabeKern';

/** Auswahlwert für „keine Einheit“; keine Einheit hat eine negative ID. */
const OHNE = -1;

export interface EinheitAngabeProps {
  /** Zeilenkennung für die zugänglichen Namen in einer Liste („Einheit zu Anna“). */
  kennung?: string;
  /** Gespeicherte Einheit (Serverstand); `null` = keine. */
  wert: number | null;
  /** Wählbare Einheiten in Baumfolge mit Pfad (`buildEinheitOptions`). */
  optionen: readonly EinheitOption[];
  darfSchreiben: boolean;
  /** Zusatz hinter dem Namen, etwa die Marke „Einheitsführer“. */
  marke?: ReactNode;
  /**
   * „Keine Einheit“ als eigene erste Wahl (LLH-1093, design.md D3): das Leeren-Kreuz der Auswahl
   * erscheint am Touchschirm nur beim Zeigen. Ohne Angabe bleibt nur das Kreuz.
   */
  ohneOption?: string;
  /**
   * Übernahme mit neuem UND bisherigem Wert: den Endpunkt wählt der Aufrufer (Zuordnung einer
   * Person, eines Fahrzeugs, eines Materials). Lehnt bei Ablehnung ab, dann bleibt die Auswahl mit
   * dem gewählten Wert offen und der Grund steht an ihr. Erfüllt erst, wenn der neue Wert im Cache
   * steht.
   */
  onSpeichern: (neu: number | null, alt: number | null) => Promise<unknown>;
}

/**
 * Einheit als Inline-Angabe (LLH-1060 D4/D14, geteilt mit LLH-1073/1093): wählen, dann
 * „Speichern“; kein Speichern beim Verlassen, denn ein Fehlgriff schriebe sofort einen ETB-Eintrag
 * und nähme still eine Führung. Unverändert sendet nichts (`InlineAngabe`). Die Auswahl zeigt den
 * Pfad („Zug 1 › Staffel A“), der Wert den Namen. Ohne Schreibrecht steht der Name als Text.
 *
 * Eine Einheit, die nicht in `optionen` steht (Liste noch alt), zeigt kein erfundenes Etikett.
 */
export default function EinheitAngabe({
  kennung,
  wert,
  optionen,
  darfSchreiben,
  marke,
  ohneOption,
  onSpeichern,
}: EinheitAngabeProps) {
  const aktuell = wert != null ? optionen.find((o) => o.id === wert) : undefined;
  const name = aktuell?.name ?? 'nicht geladen';
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
        <Select<number>
          {...feld}
          {...popup}
          value={value ?? (ohneOption ? OHNE : undefined)}
          allowClear
          placeholder="ohne Einheit"
          onChange={(v) => onChange(v == null || v === OHNE ? null : v)}
          options={[
            ...(ohneOption ? [{ value: OHNE, label: ohneOption }] : []),
            ...optionen.map((o) => ({ value: o.id, label: o.pfad })),
          ]}
          popupMatchSelectWidth={false}
          style={{ width: '100%', minWidth: 0 }}
        />
      )}
    />
  );
}
