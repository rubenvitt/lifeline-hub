import { Space, Tag } from 'antd';
import type { Einheit, EinsatzFahrzeug } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { Select } from '../components/Select';
import { monoStil } from '../components/instrument';
import { buildFahrzeugOptions, isFremdesFahrzeug } from './einteilungKern';

export interface FahrzeugAngabeProps {
  /** Zeilenkennung für die zugänglichen Namen in einer Liste („Fahrzeug zu Anna“). */
  kennung?: string;
  /** Fahrzeug der Person (Serverstand); `null` = keins. */
  wert: number | null;
  /** Einheit der Person: ihre Fahrzeuge stehen in der Auswahl vorn. */
  einheitId: number | null;
  /** Aktive Fahrzeuge des Einsatzes. */
  fahrzeuge: readonly EinsatzFahrzeug[];
  /** Für den Namen der eigenen Einheit im Gruppenkopf der Auswahl. */
  einheiten: readonly Pick<Einheit, 'id' | 'name'>[];
  darfSchreiben: boolean;
  /** Übernahme wie bei `EinheitAngabe`: neuer und bisheriger Wert, Endpunkt beim Aufrufer. */
  onSpeichern: (neu: number | null, alt: number | null) => Promise<unknown>;
}

/**
 * Fahrzeug einer Person als Inline-Angabe (LLH-1060 D4/D5): wählen, dann „Speichern“. Einheit und
 * Fahrzeug bleiben unabhängig — fährt die Person auf dem Fahrzeug einer anderen Einheit, trägt der
 * Wert die neutrale Marke „andere Einheit“ (Kennzeichnung ohne Status, `Tag` ohne Farbe). Die
 * Auswahl stellt die Fahrzeuge der eigenen Einheit voran. Funkrufnamen in Mono.
 */
export default function FahrzeugAngabe({
  kennung,
  wert,
  einheitId,
  fahrzeuge,
  einheiten,
  darfSchreiben,
  onSpeichern,
}: FahrzeugAngabeProps) {
  const aktuell = wert != null ? fahrzeuge.find((f) => f.id === wert) : undefined;
  const fremd = aktuell ? isFremdesFahrzeug(aktuell, { einheit_id: einheitId }) : false;
  const eigeneEinheit = einheitId != null ? einheiten.find((e) => e.id === einheitId) : undefined;
  const optionen = buildFahrzeugOptions(fahrzeuge, eigeneEinheit ?? null);
  return (
    <InlineAngabe<number | null>
      etikett="Fahrzeug"
      kennung={kennung}
      wert={wert}
      anzeige={
        <Space size={4} wrap>
          <span style={monoStil(13)}>{aktuell?.funkrufname ?? 'nicht geladen'}</span>
          {fremd && <Tag>andere Einheit</Tag>}
        </Space>
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
          placeholder="ohne Fahrzeug"
          onChange={(v) => onChange(v ?? null)}
          options={optionen}
          popupMatchSelectWidth={false}
          style={{ width: '100%', minWidth: 0 }}
        />
      )}
    />
  );
}
