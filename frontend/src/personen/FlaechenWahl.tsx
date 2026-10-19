import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useRollen } from '../components/instrument';

/**
 * Wahl aus einem festen Katalog als große Flächen (Change `y18v58dt-pat-kern`, design.md D13):
 * Maßnahme im Patientenkopf, Art der Verletzung am Körperschema. Dieselbe Bedienung wie die
 * Sichtungswahl (`personen/SichtungsWahl.tsx`), aber ohne Farbachse: ein Katalogwert ist kein
 * Status, die Flächen stehen neutral.
 *
 * GEWÄHLT OHNE FARBE ERKENNBAR: ✓ vor dem Wort und ein Rahmen von 3 px in der Textfarbe, dazu die
 * Auswahlfläche; die übrigen tragen 1 px `steuerRahmen`.
 *
 * ZUGÄNGLICH als `radiogroup`/`radio` mit `aria-checked`, Roving-Tabindex, Pfeile wechseln den
 * Fokus, Leertaste und Enter wählen (ein `type="button"` sendet kein Formular ab).
 *
 * FORMULARVERTRAG wie ein antd-Feld (`value`/`onChange`), damit die Wahl in einem `Form.Item`
 * hängt. Ein Tipp auf die gewählte Fläche meldet sie noch einmal: am Körperschema speichert schon
 * der Tipp (zweiter Tipp nach dem auf die Region), ein Wiederholen ist dort gewollt.
 */
export interface FlaechenOption<W extends string> {
  wert: W;
  label: string;
}

export interface FlaechenWahlProps<W extends string> {
  optionen: readonly FlaechenOption<W>[];
  value?: W | null;
  onChange?: (wert: W) => void;
  disabled?: boolean;
  id?: string;
  'aria-label': string;
}

/** Boden einer Fläche: 48 px, darüber die Steuerhöhe der Stufe (Handschuh 72). */
export const FLAECHE_BODEN = 48;
export const FLAECHE_BREITE = 112;

/**
 * Maße einer Fläche aus den aufgelösten Tokens — rein und exportiert (Muster „Handgebautes
 * Bedienziel“, LFH-365), Böden als Literale geprüft in `FlaechenWahl.test.tsx`.
 */
export function flaecheStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}): CSSProperties {
  return {
    minHeight: Math.max(FLAECHE_BODEN, token.controlHeight),
    minWidth: FLAECHE_BREITE,
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
  };
}

/** Lücke zwischen zwei Flächen: 8 px in `kompakt`, 16 px in den Berührungsstufen. */
export function flaechenLuecke(token: { controlHeight: number }): number {
  return token.controlHeight <= 30 ? 8 : 16;
}

export default function FlaechenWahl<W extends string>({
  optionen,
  value = null,
  onChange,
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: FlaechenWahlProps<W>) {
  const { token, rollen } = useRollen();
  const knoepfe = useRef<(HTMLButtonElement | null)[]>([]);
  const masse = flaecheStil(token);
  const gewaehltIndex = optionen.findIndex((o) => o.wert === value);
  const fokusIndex = Math.max(0, gewaehltIndex);

  function taste(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const schritt =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (schritt === 0) return;
    e.preventDefault();
    knoepfe.current[(index + schritt + optionen.length) % optionen.length]?.focus();
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-lfh="flaechenwahl"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${FLAECHE_BREITE}px, 1fr))`,
        gap: flaechenLuecke(token),
      }}
    >
      {optionen.map((o, index) => {
        const gewaehlt = o.wert === value;
        const strich = disabled ? 'dashed' : 'solid';
        return (
          <button
            key={o.wert}
            ref={(el) => {
              knoepfe.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={gewaehlt}
            aria-label={o.label}
            disabled={disabled}
            tabIndex={index === fokusIndex ? 0 : -1}
            data-erfassung-fokus={index === fokusIndex ? '' : undefined}
            onClick={() => {
              if (!disabled) onChange?.(o.wert);
            }}
            onKeyDown={(e) => taste(e, index)}
            style={{
              ...masse,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: 0,
              borderRadius: 0,
              font: 'inherit',
              fontSize: token.fontSize,
              fontWeight: gewaehlt ? 700 : 400,
              textAlign: 'center',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: gewaehlt ? rollen.auswahlFlaeche : rollen.flaeche,
              color: rollen.text,
              border: gewaehlt
                ? `3px ${strich} ${rollen.text}`
                : `1px ${strich} ${rollen.steuerRahmen}`,
            }}
          >
            {gewaehlt && <span aria-hidden="true">✓&nbsp;</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
