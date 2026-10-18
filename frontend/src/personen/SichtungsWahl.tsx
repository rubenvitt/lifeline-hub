import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { Sichtungskategorie } from '../api/types';
import { useRollen } from '../components/instrument';
import { sichtung } from '../theme/statusFarben';
import { sichtungsKante, sichtungsflaechen } from '../theme/tokens';
import { SK_REIHE, SK_WORT } from './personMeta';

/**
 * Die Wahl einer Sichtungskategorie nach BBK (LLH-1083, Spec `sichtungswahl`; Herleitung
 * `openspec/changes/archive/2026-10-18-knc0jyjd-sichtungswahl-flaechen/design.md`). Ein Baustein für Erfassung,
 * Nachsichtung, Patientenkopf und Zeilen-Popover; die ANZEIGE bleibt `SichtungsTag`.
 *
 * ── FLÄCHE STATT FARBFELD ──────────────────────────────────────────────────────────────
 *
 * Jede Kategorie ist eine gefüllte Fläche aus `sichtungsflaechen` (abgedunkelt bis zum
 * Textboden), Kürzel groß, Bedeutungswort darunter; „unverletzt“ bleibt ohne Farbe. Jede Fläche
 * trägt eine Kante in der Textfarbe des Modus (`sichtungsKante`): nachts verschwänden sonst Rot,
 * Blau, Grün und Schwarz, am Tag Gelb.
 *
 * ── GEWÄHLT OHNE FARBE ERKENNBAR ───────────────────────────────────────────────────────
 *
 * Die gewählte Fläche bleibt gefüllt und trägt ✓ und einen Rahmen von 3 px; die übrigen fallen in
 * die Randform (neutrale Fläche, Farbe nur als Streifen links) und bleiben wählbar. Für
 * Hilfstechnik `radiogroup`/`radio` mit `aria-checked`, Roving-Tabindex, Pfeile wechseln,
 * Leertaste und Enter wählen (ein `type="button"` sendet kein Formular ab).
 *
 * ── FORMULARVERTRAG ────────────────────────────────────────────────────────────────────
 *
 * `value`/`onChange` wie ein antd-Feld, damit der Baustein direkt in einem `Form.Item` hängt.
 * `onChange(null)` nur mit `abwaehlbar` (Erfassung: eine Person darf ohne Sichtung entstehen).
 */
export interface SichtungsWahlProps {
  value?: Sichtungskategorie | null;
  onChange?: (kategorie: Sichtungskategorie | null) => void;
  /** Ein zweiter Tipp auf die gewählte Fläche nimmt die Wahl zurück. */
  abwaehlbar?: boolean;
  disabled?: boolean;
  /** Von `Form.Item` gereicht; landet an der Gruppe. */
  id?: string;
  'aria-label'?: string;
}

/** Boden der Trefferfläche je Kategorie: 72 px in JEDER Dichte, sonst die Steuerhöhe. */
export const SICHTUNGSFLAECHE_HOEHE = 72;
export const SICHTUNGSFLAECHE_BREITE = 96;

/**
 * Maße einer Fläche aus den aufgelösten Tokens — rein und exportiert, damit über die
 * Dichtestufen prüfbar (Muster „Handgebautes Bedienziel“, LFH-365).
 */
export function sichtungsFlaecheStil(token: {
  controlHeight: number;
  paddingXS: number;
}): CSSProperties {
  return {
    minHeight: Math.max(SICHTUNGSFLAECHE_HOEHE, token.controlHeight),
    minWidth: SICHTUNGSFLAECHE_BREITE,
    padding: token.paddingXS,
  };
}

/** Lücke zwischen zwei Flächen: 8 px in `kompakt`, 16 px in den Berührungsstufen. */
export function sichtungsLuecke(token: { controlHeight: number }): number {
  return token.controlHeight <= 30 ? 8 : 16;
}

export default function SichtungsWahl({
  value = null,
  onChange,
  abwaehlbar = false,
  disabled = false,
  id,
  'aria-label': ariaLabel = 'Sichtungskategorie',
}: SichtungsWahlProps) {
  const { token, rollen } = useRollen();
  const knoepfe = useRef<(HTMLButtonElement | null)[]>([]);
  const kante = sichtungsKante(rollen);
  const masse = sichtungsFlaecheStil(token);
  // Roving-Tabindex: die gewählte Fläche, sonst die erste, ist der eine Tab-Stopp der Gruppe.
  const fokusIndex = Math.max(0, value ? SK_REIHE.indexOf(value) : 0);

  function select(k: Sichtungskategorie) {
    if (disabled) return;
    if (k === value) {
      if (abwaehlbar) onChange?.(null);
      return;
    }
    onChange?.(k);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const schritt =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (schritt === 0) return;
    e.preventDefault();
    const ziel = (index + schritt + SK_REIHE.length) % SK_REIHE.length;
    knoepfe.current[ziel]?.focus();
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-lfh="sichtungswahl"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${SICHTUNGSFLAECHE_BREITE}px, 1fr))`,
        gap: sichtungsLuecke(token),
      }}
    >
      {SK_REIHE.map((k, index) => {
        const farbe = sichtung[k].farbe;
        const gewaehlt = value === k;
        // Randform: eine ANDERE Kategorie ist gewählt — die Fläche tritt zurück, bleibt wählbar.
        const zurueck = value != null && !gewaehlt;
        const voll = farbe ? sichtungsflaechen[farbe] : null;
        const gefuellt = voll != null && !zurueck;
        const stil: CSSProperties = {
          ...masse,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          margin: 0,
          borderRadius: 0,
          font: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: gefuellt ? voll.flaeche : rollen.flaeche,
          color: gefuellt ? voll.schrift : rollen.text,
          // Gesperrt gestrichelt (Zeichen der Sperre ohne Farbe, LLH-1233).
          border: `${gewaehlt ? 3 : 1}px ${disabled ? 'dashed' : 'solid'} ${kante}`,
          // Die Randform trägt die Sichtungsfarbe als Streifen; ohne Farbe kein Streifen.
          borderInlineStart:
            zurueck && voll
              ? `8px solid ${voll.flaeche}`
              : `${gewaehlt ? 3 : 1}px ${disabled ? 'dashed' : 'solid'} ${kante}`,
        };
        return (
          <button
            key={k}
            ref={(el) => {
              knoepfe.current[index] = el;
            }}
            type="button"
            className="lfh-sichtungswahl__flaeche"
            role="radio"
            aria-checked={gewaehlt}
            data-sichtung={k}
            // Kürzel und Wort stehen in zwei Zeilen; ohne eigenen Namen läse die Hilfstechnik
            // „SK Iakut“.
            aria-label={`${sichtung[k].label}, ${SK_WORT[k]}`}
            disabled={disabled}
            tabIndex={index === fokusIndex ? 0 : -1}
            // In einer Erfassungshülle ist die Wahl das erste Feld; die Hülle greift sonst nur
            // echte `<input>` (`components/Erfassung.tsx`, `fokussiereErstesFeld`).
            data-erfassung-fokus={index === fokusIndex ? '' : undefined}
            onClick={() => select(k)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={stil}
          >
            <span style={{ fontSize: token.fontSizeLG, fontWeight: 700, lineHeight: 1.1 }}>
              {gewaehlt && <span aria-hidden="true">✓ </span>}
              {sichtung[k].label}
            </span>
            <span style={{ fontSize: token.fontSizeSM, lineHeight: 1.2 }}>{SK_WORT[k]}</span>
          </button>
        );
      })}
    </div>
  );
}
