import { AutoComplete, Button, Tooltip, Typography, theme } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useAngabeForm } from '../components/angabeForm';
import { IconStift } from '../icons';
import { InlineAngabe } from '../components/InlineAngabe';
import { PERSONAL_EINSATZFUNKTION_MAX } from '../api/eingabegrenzen';
import { filterVorschlaege } from './einsatzfunktionKern';

export interface EinsatzfunktionZelleProps {
  /** Zeilenkennung für die zugänglichen Namen. */
  name: string;
  einsatzfunktion?: string | null;
  /** Qualifikation (Stamm live oder Ad-hoc erfasst); steht sichtbar unter der Einsatzfunktion. */
  funktion?: string | null;
  vorschlaege: readonly string[];
  darfSchreiben: boolean;
  /**
   * Übernahme; `null` leert. Lehnt bei Ablehnung ab, dann bleibt die Eingabe offen.
   * `kontext.beimOeffnen` ist die Einsatzfunktion beim Öffnen (`null` = leer), Altwert des
   * Feld-CAS (LLH-1945).
   */
  onSpeichern: (
    einsatzfunktion: string | null,
    kontext: { beimOeffnen: string | null },
  ) => Promise<unknown>;
}

/**
 * Boden des Stift-Knopfs (LLH-1791): quadratisch in der kleinen Steuerhöhe der Stufe
 * (24 / 48 / 72), wie `antdKnopf()`. Rein und exportiert, Böden als Literale im Test.
 */
export function stiftStil(token: { controlHeightSM: number }): CSSProperties {
  return {
    minWidth: token.controlHeightSM,
    minHeight: token.controlHeightSM,
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/**
 * Zelle „Funktion“ der Personalliste (LLH-1067, Spec `personal-einsatzangaben`): oben die
 * Einsatzfunktion als Inline-Angabe mit Vorschlägen, darunter die Qualifikation als Text — beide
 * sichtbar, nicht im Tooltip. Ohne Schreibrecht und ohne Einsatzfunktion steht nur die
 * Qualifikation (ein „—“ darüber behauptete nichts Neues).
 *
 * LEER MIT QUALIFIKATION (LLH-1791, Change `h74aqt6p-personal-funktion-zelle`): die Qualifikation
 * steht als Wert in einer Zeile, daneben ein Stift-Knopf („Funktion zu <Name> eintragen“). Der
 * blaue Link „Funktion eintragen“ über jeder Qualifikation wiederholte sich zwölfmal und machte die
 * Zeilen doppelt hoch. Ohne Qualifikation bleibt die Aufforderung als Wort: dann steht kein Wert
 * daneben, der den Stift erklärt (`frontend/AGENTS.md`, „Ein leeres Feld muss sagen …“).
 */
export default function EinsatzfunktionZelle({
  name,
  einsatzfunktion,
  funktion,
  vorschlaege,
  darfSchreiben,
  onSpeichern,
}: EinsatzfunktionZelleProps) {
  const { token } = theme.useToken();
  const [isOffen, setOffen] = useState(false);
  const angabeForm = useAngabeForm().form;
  const wert = einsatzfunktion ?? '';
  const qualifikation = funktion ? (
    <Typography.Text type="secondary" style={{ display: 'block', overflowWrap: 'anywhere' }}>
      {funktion}
    </Typography.Text>
  ) : null;

  if (!darfSchreiben && !wert.trim()) return qualifikation ?? <>—</>;

  const leerMitQualifikation = !wert.trim() && Boolean(funktion);
  // Im Fluss (Karte) ersetzt die offene Eingabe den Auslöser samt Qualifikation; dann steht sie
  // darunter, damit beide sichtbar bleiben (Spec `personal-einsatzangaben`). Schwebend in der
  // Tabelle bleibt der Auslöser stehen.
  const isFluss = angabeForm === 'fluss';

  return (
    <div style={{ minWidth: 0 }}>
      <InlineAngabe<string>
        etikett="Funktion"
        kennung={name}
        wert={wert}
        anzeige={wert}
        leer={(w) => w.trim() === ''}
        gleich={(a, b) => a.trim() === b.trim()}
        darfSchreiben={darfSchreiben}
        onSpeichern={(w, { beimOeffnen }) =>
          onSpeichern(w.trim() || null, { beimOeffnen: beimOeffnen.trim() || null })
        }
        onOeffnen={() => setOffen(true)}
        onSchliessen={() => setOffen(false)}
        ausloeser={
          leerMitQualifikation
            ? ({ ref, onClick, disabled }) => (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: token.paddingXS,
                    minWidth: 0,
                  }}
                >
                  <span style={{ minWidth: 0, overflowWrap: 'break-word' }}>{funktion}</span>
                  <Tooltip title="Funktion eintragen">
                    <Button
                      ref={ref}
                      type="text"
                      aria-label={`Funktion zu ${name} eintragen`}
                      disabled={disabled}
                      onClick={onClick}
                      style={stiftStil(token)}
                      icon={<IconStift />}
                    />
                  </Tooltip>
                </span>
              )
            : undefined
        }
        eingabe={({ feld, value, onChange, popup }) => (
          <AutoComplete
            {...feld}
            {...popup}
            value={value}
            onChange={(v?: string) => onChange(v ?? '')}
            options={filterVorschlaege(vorschlaege, value).map((v) => ({ value: v }))}
            maxLength={PERSONAL_EINSATZFUNKTION_MAX}
            style={{ width: '100%' }}
          />
        )}
      />
      {leerMitQualifikation && !(isOffen && isFluss) ? null : qualifikation}
    </div>
  );
}
