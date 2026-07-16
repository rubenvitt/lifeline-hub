import { Input, Space } from 'antd';
import { Select } from '../../components/Select';
import TaktischesZeichen, {
  einheiten,
  fachaufgaben,
  funktionen,
  grundzeichen as grundzeichenKatalog,
  organisationen,
  symbole,
} from 'taktische-zeichen-react';
import type { GrundzeichenId } from 'taktische-zeichen-react';
import type { FreiesZeichenUpdate } from '../../api/types';
import { grundzeichenAkzeptiert } from './taktischesZeichen';
import { baueFreiesZeichenTz } from './marker';

export interface FreiesZeichenPickerProps {
  wert: FreiesZeichenUpdate;
  onChange: (spec: FreiesZeichenUpdate) => void;
}

/** Die 5 accepts-gegateten Overlay-Felder. `key` ist zugleich der ComponentType fürs
 *  {@link grundzeichenAkzeptiert}-Gating und der FreiesZeichenUpdate-Feldname. */
type OverlayKey = 'organisation' | 'fachaufgabe' | 'symbol' | 'einheit' | 'funktion';

const OVERLAYS: { key: OverlayKey; label: string; katalog: readonly { id: string; label: string }[] }[] = [
  { key: 'organisation', label: 'Organisation', katalog: organisationen },
  { key: 'fachaufgabe', label: 'Fachaufgabe', katalog: fachaufgaben },
  { key: 'symbol', label: 'Symbol', katalog: symbole },
  { key: 'einheit', label: 'Einheit', katalog: einheiten },
  { key: 'funktion', label: 'Funktion', katalog: funktionen },
];

const NEUTRALE_FARBE = '#333333';

/** Entfernt beim Grundzeichen-Wechsel alle Overlays, die das neue Grundzeichen laut
 *  accepts-Katalog nicht rendert — → `null` (nicht `undefined`) für den Whole-Spec-PATCH,
 *  damit kein Phantom-Overlay den tz-Icon-Key divergieren lässt. */
function strippeNichtAkzeptierte(spec: FreiesZeichenUpdate): FreiesZeichenUpdate {
  const gz = spec.grundzeichen;
  return {
    ...spec,
    organisation: grundzeichenAkzeptiert(gz, 'organisation') ? spec.organisation : null,
    fachaufgabe: grundzeichenAkzeptiert(gz, 'fachaufgabe') ? spec.fachaufgabe : null,
    symbol: grundzeichenAkzeptiert(gz, 'symbol') ? spec.symbol : null,
    einheit: grundzeichenAkzeptiert(gz, 'einheit') ? spec.einheit : null,
    funktion: grundzeichenAkzeptiert(gz, 'funktion') ? spec.funktion : null,
  };
}

/**
 * Controlled Editor für die DV-102-Spec eines freien taktischen Zeichens (LFH-170).
 * Grundzeichen (voller Katalog) + accepts-gegatete Overlay-Selects + Farbe/Bezeichnung,
 * mit Live-Vorschau. Die Vorschau nutzt die accepts-gestrippte Spec (identisch zum
 * Karten-Marker via {@link baueFreiesZeichenTz}), sodass kein Phantom-Overlay entsteht.
 */
export default function FreiesZeichenPicker({ wert, onChange }: FreiesZeichenPickerProps) {
  const setGrundzeichen = (gz: string) =>
    onChange(strippeNichtAkzeptierte({ ...wert, grundzeichen: gz as GrundzeichenId }));
  const setOverlay = (key: OverlayKey, v: string | null) =>
    onChange({ ...wert, [key]: v } as FreiesZeichenUpdate);

  const vorschau = baueFreiesZeichenTz(wert);

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }} aria-label="Vorschau">
        <TaktischesZeichen {...vorschau} style={{ width: 56, height: 56 }} />
      </div>

      <Select
        aria-label="Grundzeichen"
        style={{ width: '100%' }}
        value={wert.grundzeichen}
        options={grundzeichenKatalog.map((g) => ({ value: g.id, label: g.label }))}
        onChange={setGrundzeichen}
      />

      {OVERLAYS.map(({ key, label, katalog }) =>
        grundzeichenAkzeptiert(wert.grundzeichen, key) ? (
          <Select
            key={key}
            aria-label={label}
            allowClear
            placeholder={label}
            style={{ width: '100%' }}
            value={(wert[key] as string | null | undefined) ?? undefined}
            options={katalog.map((k) => ({ value: k.id, label: k.label }))}
            onChange={(v?: string) => setOverlay(key, v ?? null)}
          />
        ) : null,
      )}

      <Input
        aria-label="Farbe"
        type="color"
        defaultValue={wert.farbe ?? NEUTRALE_FARBE}
        onBlur={(e) => {
          if (e.target.value !== (wert.farbe ?? NEUTRALE_FARBE)) onChange({ ...wert, farbe: e.target.value });
        }}
      />

      <Input
        aria-label="Bezeichnung"
        placeholder="Bezeichnung"
        defaultValue={wert.label ?? ''}
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (t !== (wert.label ?? '')) onChange({ ...wert, label: t || null });
        }}
      />
    </Space>
  );
}
