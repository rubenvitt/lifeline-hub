import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { listePersonen } from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import type { Sichtungskategorie, UhsDetail } from '../../api/types';
import SichtungsTag from '../../components/SichtungsTag';
import { Kennzahl, Kennzahlenband, type Segment } from '../../components/instrument';
import { monoStil, useRollen } from '../../components/instrument/rollenwerte';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { SICHTUNGSBILD_REIHE, type SichtungsbildSchluessel } from '../../personen/personenBilanz';
import { sichtung } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import { wartezeitText } from './dringlichkeit';
import { uhsLage } from './uhsLage';

interface UhsLagezeileProps {
  einsatzId: number;
  uhs: UhsDetail;
  /**
   * Sprungziele der Zahlen. Ohne Ziel bleibt die Zahl Text: über dem Grundriss zeigt die Fläche
   * darunter dasselbe, ein Sprung dorthin wäre keiner.
   */
  ziele?: { grundriss?: string; patienten?: string };
  /**
   * `zeile` (Vorgabe, Fükw über dem Grundriss): EINE Schriftzeile ohne Sprünge. Ein Band aus
   * Kennzahlen wäre dort gut 140 px hoch; Kopf, Band und die 380 px des Grundrisses passten bei
   * 1366 × 844 nicht mehr ins Fenster, die Seite rollte, und die Bildlaufleiste kippte den
   * Grundriss in eine ResizeObserver-Schleife (`e2e/uhs-hoehe.spec.ts`). `band` (UHS-Laptop, kein
   * Grundriss darunter): Kennzahlen mit Sprung, Trefffläche und Aufgliederung.
   */
  form?: 'zeile' | 'band';
}

function kuerzel(k: SichtungsbildSchluessel): string {
  return k === 'ohne' ? 'ohne Sichtung' : sichtung[k].label;
}

/**
 * Lage der Stelle in Zahlen (LLH-1136), an Fükw (`UhsDetailPage`) und UHS-Laptop
 * (`geraet/GeraetStellePage`) gleich: In der Stelle mit SK-Aufgliederung, Plätze frei, Wartend
 * mit längster Wartezeit, Abtransportiert. Ohne Personennamen. Die Zahlen leitet `uhsLage.ts`
 * aus denselben Mengen wie der Grundriss ab; derselbe Personen-Abruf wie dort (ein Cache-Fach).
 *
 * Feste Höhe: die Zeile ist eine Schriftzeile; im Band trägt jede Zelle im Datenzustand immer eine
 * Notiz, das Band hält ihre Höhe (`notizZeilen`). Live fließen nur die Zahlen, nichts springt.
 */
export default function UhsLagezeile({ einsatzId, uhs, ziele, form = 'zeile' }: UhsLagezeileProps) {
  const { token, rollen } = useRollen();
  const jetzt = useMinutenTakt();
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const zustand = personenQuery.isError ? 'fehler' : personenQuery.isLoading ? 'laden' : 'daten';
  const lage = uhsLage(uhs, personenQuery.data ?? [], jetzt);

  // Alle Kategorien, auch die leeren: der zugängliche Name zählt vollständig auf (wie die
  // Seitenleiste der Betroffenen); die Notiz nennt nur die besetzten.
  const segmente: Segment[] = SICHTUNGSBILD_REIHE.map((k) => {
    const f = k === 'ohne' ? null : sichtung[k].farbe;
    return {
      label: kuerzel(k),
      wert: lage.sichtung[k],
      farbe: f ? sichtungsfarben[f] : rollen.flaeche3,
      umrandung: token.colorTextTertiary,
    };
  });
  const besetzt = segmente.filter((s) => s.wert > 0).map((s) => `${s.label} ${s.wert}`);
  const platzZusatz =
    lage.plaetze.inAufbereitung > 0
      ? `${lage.plaetze.inAufbereitung} in Aufbereitung`
      : `${lage.plaetze.belegt} belegt`;
  const warteZusatz =
    lage.laengsteWarteMin != null
      ? `längste ${wartezeitText(lage.laengsteWarteMin)}`
      : 'niemand wartet';

  if (form === 'zeile') {
    // Ohne Daten keine Zahl: über einem Ladefehler stünden sonst Nullen, die niemand erhoben hat.
    const zahl = (wert: string | number) =>
      zustand === 'daten' ? wert : zustand === 'laden' ? '…' : '–';
    const posten: { titel: string; wert: string | number; zusatz?: ReactNode }[] = [
      {
        titel: 'In der Stelle',
        wert: lage.inDerStelle,
        zusatz:
          besetzt.length > 0 ? (
            <span>
              {SICHTUNGSBILD_REIHE.filter((k) => k !== 'ohne' && lage.sichtung[k] > 0).map((k) => (
                <span key={k} style={{ whiteSpace: 'nowrap' }}>
                  <SichtungsTag form="kompakt" kategorie={k as Sichtungskategorie} />{' '}
                  {lage.sichtung[k]}
                </span>
              ))}
              {lage.sichtung.ohne > 0 && <span>ohne Sichtung {lage.sichtung.ohne}</span>}
            </span>
          ) : (
            'ohne Patienten'
          ),
      },
      {
        titel: 'Plätze frei',
        wert: `${lage.plaetze.frei} / ${lage.plaetze.gesamt}`,
        zusatz: platzZusatz,
      },
      { titel: 'Wartend', wert: lage.wartend, zusatz: warteZusatz },
      { titel: 'Abtransportiert', wert: lage.abtransportiert },
    ];
    const volltext = posten
      .map((p) =>
        [p.titel, p.wert, p.titel === 'In der Stelle' ? besetzt.join(' · ') : p.zusatz]
          .filter((t) => t != null && t !== '')
          .join(' '),
      )
      .join(' · ');
    return (
      <div
        role="group"
        aria-label="Lage der Stelle"
        data-lfh="uhs-lagezeile"
        // EINE Zeile, auch wenn live eine SK-Stufe dazukommt oder „59 min“ zu „1 h 00 min“ wird:
        // ein Umbruch ließe den Grundriss darunter springen. Was nicht passt, schneidet der Rand ab,
        // der volle Wortlaut steht im Titel.
        title={zustand === 'daten' ? volltext : undefined}
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: rollen.text,
        }}
      >
        {posten.map((p) => (
          <span key={p.titel} style={{ marginInlineEnd: token.marginLG }}>
            <span style={{ color: rollen.schwach }}>{p.titel}</span>{' '}
            <b style={{ ...monoStil(16, 500) }}>{zahl(p.wert)}</b>
            {zustand === 'daten' && p.zusatz != null && (
              <>
                {' '}
                <span style={{ color: rollen.gedaempft }}>{p.zusatz}</span>
              </>
            )}
          </span>
        ))}
        {zustand === 'fehler' && <span style={{ color: rollen.gedaempft }}>Stand unbekannt</span>}
      </div>
    );
  }

  return (
    <Kennzahlenband beschriftung="Lage der Stelle" notizZeilenSchmal={1} notizZeilen={1}>
      <Kennzahl
        titel="In der Stelle"
        groesse="klein"
        wert={lage.inDerStelle}
        zustand={zustand}
        aufgliederung={{ segmente, titel: 'In der Stelle nach Sichtung', legende: false }}
        notiz={besetzt.length > 0 ? besetzt.join(' · ') : 'ohne Patienten'}
        ziel={ziele?.patienten}
      />
      <Kennzahl
        titel="Plätze frei"
        groesse="klein"
        wert={`${lage.plaetze.frei} / ${lage.plaetze.gesamt}`}
        zustand={zustand}
        ton="normal"
        notiz={platzZusatz}
        ziel={ziele?.grundriss}
      />
      <Kennzahl
        titel="Wartend"
        groesse="klein"
        wert={lage.wartend}
        zustand={zustand}
        ton={lage.wartend > 0 ? 'bedien' : 'neutral'}
        notiz={warteZusatz}
        ziel={ziele?.grundriss}
      />
      <Kennzahl
        titel="Abtransportiert"
        groesse="klein"
        wert={lage.abtransportiert}
        zustand={zustand}
        notiz="aus dieser Stelle"
        ziel={ziele?.grundriss}
      />
    </Kennzahlenband>
  );
}
