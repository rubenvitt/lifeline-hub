import type { Betreuungsstelle } from '../api/types';
import { Kennzahl, Kennzahlenband } from '../components/instrument';
import { auslastung } from '../theme/statusFarben';
import { freiePlaetze, personenZahl } from './betreuungText';

/**
 * „Belegung in Zahlen" einer Betreuungsstelle (LLH-1044): Belegt, Kapazität, Frei und — nur mit
 * Personenrecht — „Davon namentlich". Ein Baustein für die Detailseite der Führung und das Gerät
 * der Stelle (LFH-1041), damit beide dieselben Zahlen gleich lesen.
 *
 * - Ohne Meldung steht „keine Meldung" statt einer 0: nichts gemeldet ist nicht niemand da.
 * - Das Auslastungswort („fast voll", „voll", „überbelegt", {@link auslastung}) steht als Notiz
 *   unter „Belegt" und tönt die Zahl: das Wort ist der zweite Kanal neben der Farbe.
 * - „Frei" kommt aus der einen {@link freiePlaetze}, nie negativ.
 * - „Davon namentlich" fehlt ohne Personenrecht ganz (Abwesenheit statt 0). Ein Hinweis neben der
 *   Mengenmeldung, kein Summand.
 */
export default function StelleBelegung({
  stelle,
  namentlich,
}: {
  stelle: Pick<Betreuungsstelle, 'belegung' | 'kapazitaet_personen'>;
  /** Einzeln hierher verbrachte Personen; `undefined` ohne Personenrecht. */
  namentlich: number | undefined;
}) {
  const belegt = stelle.belegung?.belegt;
  const stufe = auslastung(belegt, stelle.kapazitaet_personen);
  const frei = freiePlaetze(stelle);
  return (
    <Kennzahlenband beschriftung="Belegung in Zahlen">
      <Kennzahl
        titel="Belegt"
        wert={belegt != null ? personenZahl(belegt) : '—'}
        notiz={belegt == null ? 'keine Meldung' : stufe?.label}
        ton={
          stufe
            ? stufe.rolle === 'alarm'
              ? 'alarm'
              : 'achtung'
            : belegt != null
              ? 'bedien'
              : 'neutral'
        }
      />
      <Kennzahl
        titel="Kapazität"
        wert={stelle.kapazitaet_personen != null ? personenZahl(stelle.kapazitaet_personen) : '—'}
        notiz={stelle.kapazitaet_personen == null ? 'nicht festgelegt' : undefined}
      />
      <Kennzahl
        titel="Frei"
        wert={frei != null ? personenZahl(frei) : '—'}
        ton={frei === 0 ? 'achtung' : frei != null ? 'normal' : 'neutral'}
      />
      {namentlich !== undefined && (
        <Kennzahl titel="Davon namentlich" wert={personenZahl(namentlich)} />
      )}
    </Kennzahlenband>
  );
}
