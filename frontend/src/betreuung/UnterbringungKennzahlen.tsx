import { theme } from 'antd';
import { useMemo } from 'react';
import type { Betreuungsstelle, StelleNamentlich } from '../api/types';
import { Kennzahl, Kennzahlenband } from '../components/instrument';
import { personenZahl } from './betreuungText';
import { unterbringungKennzahl } from './unterbringungKennzahl';

/** Titel der Zellen, auch für die Platzhalter im Ladezustand. */
const TITEL = [
  'In Betreuung',
  'Kapazität',
  'Frei',
  'Stellen in Betrieb',
  'Voll/überbelegt',
] as const;

/** „1 Stelle" / „2 Stellen". */
const stellenWort = (n: number) => (n === 1 ? '1 Stelle' : `${personenZahl(n)} Stellen`);

/**
 * Kennzahlenband der Betreuungsübersicht (LLH-1050): „Unterbringung in Zahlen" — In Betreuung,
 * Kapazität, Frei, Stellen in Betrieb, Voll/überbelegt und mit Personenrecht „Davon namentlich".
 * Die Leitfrage (wie viele sind untergebracht, wo ist Platz, welche Stelle ist voll) in einer
 * Zeile, bevor die Tabelle Stelle für Stelle folgt. Gerechnet wird nur in
 * {@link unterbringungKennzahl}; hier steht nur Wortlaut und Ton.
 *
 * - Abwesenheit statt 0: ohne jede Meldung steht bei „In Betreuung" „—" mit „keine Meldung",
 *   ohne jede Kapazität bei „Kapazität" und „Frei" „—". Ohne Stelle entfällt das Band (die Seite
 *   zeigt dann den Leerzustand), ohne Personenrecht die Zelle „Davon namentlich".
 * - Ton: „Frei" 0 `achtung` (kein Platz mehr), sonst `normal`; „Voll/überbelegt" über 0 `alarm`.
 *   Das Wort in Augenbraue und Notiz ist der zweite Kanal.
 * - Die Notizen stehen einzeilig (`notizZeilen`), das Band hält seine Höhe bei Live-Meldungen.
 *   Bei 390 px bricht es in zwei Spalten um (`auto-fit` des Bands), ohne Querscrollen.
 */
export default function UnterbringungKennzahlen({
  stellen,
  namentlich,
  ladend,
}: {
  stellen: readonly Betreuungsstelle[];
  /** „davon namentlich" je Stelle; fehlt ohne Personenrecht. */
  namentlich?: readonly StelleNamentlich[] | null;
  ladend: boolean;
}) {
  const { token } = theme.useToken();
  const k = useMemo(() => unterbringungKennzahl(stellen, namentlich), [stellen, namentlich]);
  const abstand = { marginBottom: token.marginLG };

  if (ladend) {
    return (
      <div data-lfh="unterbringung-kennzahlen" style={abstand}>
        <Kennzahlenband beschriftung="Unterbringung in Zahlen" notizZeilen={1}>
          {TITEL.map((titel) => (
            <Kennzahl key={titel} titel={titel} wert={null} zustand="laden" groesse="klein" />
          ))}
        </Kennzahlenband>
      </div>
    );
  }
  if (k == null) return null;

  const zahl = (n: number | null) => (n == null ? '—' : personenZahl(n));
  return (
    <div data-lfh="unterbringung-kennzahlen" style={abstand}>
      <Kennzahlenband beschriftung="Unterbringung in Zahlen" notizZeilen={1}>
        <Kennzahl
          titel="In Betreuung"
          wert={zahl(k.inBetreuung)}
          groesse="klein"
          notiz={
            k.inBetreuung == null
              ? 'keine Meldung'
              : k.ohneMeldung > 0
                ? `${stellenWort(k.ohneMeldung)} ohne Meldung`
                : undefined
          }
        />
        <Kennzahl
          titel="Kapazität"
          wert={zahl(k.kapazitaet)}
          groesse="klein"
          notiz={
            k.kapazitaet == null
              ? 'nicht festgelegt'
              : k.ohneKapazitaet > 0
                ? `${personenZahl(k.ohneKapazitaet)} ohne Kapazität`
                : undefined
          }
        />
        <Kennzahl
          titel="Frei"
          wert={zahl(k.frei)}
          groesse="klein"
          ton={k.frei == null ? 'neutral' : k.frei === 0 ? 'achtung' : 'normal'}
          notiz={
            k.freiOhneMeldung > 0 ? `${personenZahl(k.freiOhneMeldung)} ohne Meldung` : undefined
          }
        />
        <Kennzahl
          titel="Stellen in Betrieb"
          wert={personenZahl(k.inBetrieb)}
          groesse="klein"
          notiz={`von ${personenZahl(k.stellen)}`}
        />
        <Kennzahl
          titel="Voll/überbelegt"
          wert={personenZahl(k.voll)}
          groesse="klein"
          ton={k.voll > 0 ? 'alarm' : 'neutral'}
        />
        {k.namentlich !== undefined && (
          <Kennzahl titel="Davon namentlich" wert={personenZahl(k.namentlich)} groesse="klein" />
        )}
      </Kennzahlenband>
    </div>
  );
}
