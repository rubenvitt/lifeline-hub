import { AutoComplete, Typography } from 'antd';
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
  /** Übernahme; `null` leert. Lehnt bei Ablehnung ab, dann bleibt die Eingabe offen. */
  onSpeichern: (einsatzfunktion: string | null) => Promise<unknown>;
}

/**
 * Zelle „Funktion“ der Personalliste (LLH-1067, Spec `personal-einsatzangaben`): oben die
 * Einsatzfunktion als Inline-Angabe mit Vorschlägen, darunter die Qualifikation als Text — beide
 * sichtbar, nicht im Tooltip. Ohne Schreibrecht und ohne Einsatzfunktion steht nur die
 * Qualifikation (ein „—“ darüber behauptete nichts Neues).
 */
export default function EinsatzfunktionZelle({
  name,
  einsatzfunktion,
  funktion,
  vorschlaege,
  darfSchreiben,
  onSpeichern,
}: EinsatzfunktionZelleProps) {
  const wert = einsatzfunktion ?? '';
  const qualifikation = funktion ? (
    <Typography.Text type="secondary" style={{ display: 'block', overflowWrap: 'anywhere' }}>
      {funktion}
    </Typography.Text>
  ) : null;

  if (!darfSchreiben && !wert.trim()) return qualifikation ?? <>—</>;

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
        onSpeichern={(w) => onSpeichern(w.trim() || null)}
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
      {qualifikation}
    </div>
  );
}
