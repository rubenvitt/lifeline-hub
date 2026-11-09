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
 * der Tipp (zweiter Tipp nach dem auf die Region), ein Wiederholen ist dort gewollt. Mit
 * `onAbwaehlen` nimmt der Tipp auf die gewählte Fläche die Wahl stattdessen zurück (Anlass der
 * Hilfeleistung, LLH-1566: eine Person darf ohne Anlass bleiben), wie `abwaehlbar` der
 * Sichtungswahl.
 */
export interface FlaechenOption<W extends string> {
  wert: W;
  label: string;
  /**
   * Zugänglicher Name, wo die Fläche ein Kurzwort trägt (Kostform „Veg.“ → „vegetarisch“,
   * LLH-1612); ohne ihn nennt die Fläche ihren Wortlaut.
   */
  name?: string;
}

export interface FlaechenWahlProps<W extends string> {
  optionen: readonly FlaechenOption<W>[];
  value?: W | null;
  onChange?: (wert: W) => void;
  /** Tipp auf die gewählte Fläche nimmt die Wahl zurück, statt sie zu wiederholen. */
  onAbwaehlen?: () => void;
  disabled?: boolean;
  id?: string;
  'aria-label': string;
  /**
   * Mindestbreite einer Fläche; Vorgabe {@link FLAECHE_BREITE}. Schmaler nur für Kurzwörter in
   * einer Zeile neben anderen Feldern (Kostform der Registrierung, LLH-1612), nie unter 48 px.
   */
  breite?: number;
}

/** Boden einer Fläche: 48 px, darüber die Steuerhöhe der Stufe (Handschuh 72). */
export const FLAECHE_BODEN = 48;
export const FLAECHE_BREITE = 112;

/**
 * Maße einer Fläche aus den aufgelösten Tokens — rein und exportiert (Muster „Handgebautes
 * Bedienziel“, LFH-365), Böden als Literale geprüft in `FlaechenWahl.test.tsx`.
 */
export function flaecheStil(
  token: {
    controlHeight: number;
    paddingXS: number;
    paddingSM: number;
  },
  breite: number = FLAECHE_BREITE,
): CSSProperties {
  return {
    minHeight: Math.max(FLAECHE_BODEN, token.controlHeight),
    minWidth: Math.max(FLAECHE_BODEN, breite),
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
  };
}

/** Lücke zwischen zwei Flächen: 8 px in `kompakt`, 16 px in den Berührungsstufen. */
export function flaechenLuecke(token: { controlHeight: number }): number {
  return token.controlHeight <= 30 ? 8 : 16;
}

type Rollen = ReturnType<typeof useRollen>['rollen'];

/** Eine Fläche, gewählt oder nicht: dieselbe Gestalt für Einfach- und Mehrfachwahl. */
function knopfStil(
  masse: CSSProperties,
  fontSize: number,
  rollen: Rollen,
  gewaehlt: boolean,
  strich: 'dashed' | 'solid',
  gesperrt: boolean,
): CSSProperties {
  return {
    ...masse,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 0,
    borderRadius: 0,
    font: 'inherit',
    fontSize,
    fontWeight: gewaehlt ? 700 : 400,
    textAlign: 'center',
    cursor: gesperrt ? 'not-allowed' : 'pointer',
    background: gewaehlt ? rollen.auswahlFlaeche : rollen.flaeche,
    color: rollen.text,
    border: gewaehlt ? `3px ${strich} ${rollen.text}` : `1px ${strich} ${rollen.steuerRahmen}`,
  };
}

export default function FlaechenWahl<W extends string>({
  optionen,
  value = null,
  onChange,
  onAbwaehlen,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  breite = FLAECHE_BREITE,
}: FlaechenWahlProps<W>) {
  const { token, rollen } = useRollen();
  const knoepfe = useRef<(HTMLButtonElement | null)[]>([]);
  const masse = flaecheStil(token, breite);
  const spalte = Math.max(FLAECHE_BODEN, breite);
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
        gridTemplateColumns: `repeat(auto-fill, minmax(${spalte}px, 1fr))`,
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
            aria-label={o.name ?? o.label}
            disabled={disabled}
            tabIndex={index === fokusIndex ? 0 : -1}
            data-erfassung-fokus={index === fokusIndex ? '' : undefined}
            onClick={() => {
              if (disabled) return;
              if (gewaehlt && onAbwaehlen) onAbwaehlen();
              else onChange?.(o.wert);
            }}
            onKeyDown={(e) => taste(e, index)}
            style={knopfStil(masse, token.fontSize, rollen, gewaehlt, strich, disabled)}
          >
            {gewaehlt && <span aria-hidden="true">✓&nbsp;</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface FlaechenMehrfachWahlProps<W extends string> {
  optionen: readonly FlaechenOption<W>[];
  value?: readonly W[];
  onChange?: (werte: W[]) => void;
  /** Höchstens so viele: danach sind die übrigen Flächen gesperrt, bis eine abgewählt ist. */
  max?: number;
  disabled?: boolean;
  id?: string;
  'aria-label': string;
}

/**
 * Mehrfachwahl aus einem festen Katalog als Flächen (LLH-1572: bis zu drei Maßnahmen eines
 * leichten Falls). Gestalt wie {@link FlaechenWahl}, aber jede Fläche ist ein Schalter
 * (`aria-pressed`) in einer benannten Gruppe: ein Tipp wählt, ein zweiter nimmt zurück. Ist
 * `max` erreicht, stehen die übrigen Flächen gesperrt (gestrichelt), die gewählten bleiben
 * abwählbar. Die Folge der Werte ist die Folge der Optionen, nicht die der Tipps.
 */
export function FlaechenMehrfachWahl<W extends string>({
  optionen,
  value = [],
  onChange,
  max,
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: FlaechenMehrfachWahlProps<W>) {
  const { token, rollen } = useRollen();
  const masse = flaecheStil(token);
  const voll = max != null && value.length >= max;

  return (
    <div
      id={id}
      role="group"
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
        const gewaehlt = value.includes(o.wert);
        const gesperrt = disabled || (voll && !gewaehlt);
        return (
          <button
            key={o.wert}
            type="button"
            aria-pressed={gewaehlt}
            aria-label={o.label}
            disabled={gesperrt}
            data-erfassung-fokus={index === 0 ? '' : undefined}
            onClick={() => {
              if (gesperrt) return;
              const neu = gewaehlt
                ? value.filter((w) => w !== o.wert)
                : optionen.map((x) => x.wert).filter((w) => w === o.wert || value.includes(w));
              onChange?.(neu);
            }}
            style={knopfStil(
              masse,
              token.fontSize,
              rollen,
              gewaehlt,
              gesperrt ? 'dashed' : 'solid',
              gesperrt,
            )}
          >
            {gewaehlt && <span aria-hidden="true">✓&nbsp;</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
