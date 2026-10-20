import { theme } from 'antd';
import { Kennzahl, Kennzahlenband } from '../components/instrument';
import type { Evakuierungsbezirk } from '../api/types';
import { personenZahl } from './betreuungText';
import { bezirkLage } from './evakuierungKennzahl';
import { useMemo } from 'react';

/**
 * Kennzahlenband der Evakuierungsseite (LLH-1034): Evakuiert, Geplant, Räumung läuft, Geräumt,
 * Ohne Meldung — die Lage der Räumung in einer Zeile, bevor die Tabelle Bezirk für Bezirk folgt.
 *
 * Ohne aktiven Bezirk entfällt das Band ganz (Abwesenheit, keine Nullen); die leere Tabelle
 * darunter sagt dann „Keine Evakuierungsbezirke". Während des ersten Abrufs stehen die Zellen im
 * Zustand `laden` an ihrem Platz, nach einem Fehler ohne Daten zeigt die Seite ihren Fehler statt
 * des Bands.
 *
 * „≈" ist der zweite Kanal einer Schätzung, getrennt für Stand („Evakuiert") und Plangröße
 * („Geplant"). Ohne jede Standmeldung steht bei „Evakuiert" „—" statt 0: nichts gemeldet ist
 * nicht niemand evakuiert. Kein Ton: weder „Evakuiert" noch „Ohne Meldung" hat eine Schwelle.
 */
export default function EvakuierungKennzahlen({
  bezirke,
  ladend,
}: {
  bezirke: readonly Evakuierungsbezirk[];
  ladend: boolean;
}) {
  const { token } = theme.useToken();
  const lage = useMemo(() => bezirkLage(bezirke), [bezirke]);
  const abstand = { marginBottom: token.marginLG };

  if (ladend) {
    return (
      <div data-lfh="evakuierung-kennzahlen" style={abstand}>
        <Kennzahlenband beschriftung="Räumung in Zahlen" notizZeilen={1}>
          {['Evakuiert', 'Geplant', 'Räumung läuft', 'Geräumt', 'Ohne Meldung'].map((titel) => (
            <Kennzahl key={titel} titel={titel} wert={null} zustand="laden" groesse="klein" />
          ))}
        </Kennzahlenband>
      </div>
    );
  }
  if (lage == null) return null;

  const { kennzahl: k } = lage;
  const ca = (geschaetzt: boolean) => (geschaetzt ? '≈ ' : '');
  const evakuiert =
    k.evakuiert == null ? '—' : `${ca(lage.standGeschaetzt)}${personenZahl(k.evakuiert)}`;
  const anteil =
    k.evakuiert != null && k.geplant > 0 ? Math.round((k.evakuiert / k.geplant) * 100) : null;

  return (
    <div data-lfh="evakuierung-kennzahlen" style={abstand}>
      <Kennzahlenband beschriftung="Räumung in Zahlen" notizZeilen={1}>
        <Kennzahl
          titel="Evakuiert"
          wert={evakuiert}
          groesse="klein"
          notiz={anteil == null ? 'keine Meldung' : `${anteil} % der Planung`}
        />
        <Kennzahl
          titel="Geplant"
          wert={`${ca(lage.planGeschaetzt)}${personenZahl(k.geplant)}`}
          groesse="klein"
          notiz={k.bezirke === 1 ? 'in 1 Bezirk' : `in ${personenZahl(k.bezirke)} Bezirken`}
        />
        <Kennzahl
          titel="Räumung läuft"
          wert={personenZahl(lage.laeuft)}
          groesse="klein"
          notiz={lage.angeordnet > 0 ? `${personenZahl(lage.angeordnet)} angeordnet` : undefined}
        />
        <Kennzahl titel="Geräumt" wert={personenZahl(lage.geraeumt)} groesse="klein" />
        <Kennzahl
          titel="Ohne Meldung"
          wert={personenZahl(k.ohneMeldung)}
          groesse="klein"
          notiz={k.ohneMeldung === 1 ? 'Bezirk' : 'Bezirke'}
        />
      </Kennzahlenband>
    </div>
  );
}
