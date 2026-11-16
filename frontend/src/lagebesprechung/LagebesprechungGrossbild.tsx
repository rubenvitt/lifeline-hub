import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { AbrufZustand } from '../api/abrufZustand';
import type { EinsatzAnzeige, LagebesprechungStand } from '../api/types';
import {
  GROSS_BEZUG,
  GrossKennzahl,
  GrossZeile,
  GrossZeilen,
  GrossbildFlaeche,
  grossMass,
  type GrossZustand,
} from '../components/grossbild';
import { useRollen } from '../components/instrument';
import { modulName } from '../einsatz/modulRegistry';
import { lagebildZeit, standText } from '../pages/lage-dashboard/lagebild';
import { lagebesprechungZustand } from './lagebesprechungZustand';
import type { Vorbereitung } from './useVorbereitung';

/**
 * Was als große Zahl steht: Ziffern mit Trennern (Stärke „0/12/58//70“, Zeit „1430“) und „Nr. 3“.
 * Alles andere („keiner“, „kein Termin“, die Sichtung) steht als Wort, kleiner und umbrechend.
 */
const ALS_ZAHL = /^(Nr\. )?[\d\s.,:/+–—-]+$/;
/** Elf Zeilen in drei Spalten: vier Reihen passen bei 16:9 unter den Termin. */
const SPALTEN = 3;

interface LagebesprechungGrossbildProps {
  einsatz: EinsatzAnzeige | undefined;
  stand: LagebesprechungStand | undefined;
  /**
   * Zustand der Termin-Abfrage aus `abrufZustand`, nie aus `isLoading`: eine ohne Netz pausierte
   * Abfrage ist nicht `isLoading` und stünde sonst als „0 abgeschlossen“ da (Review vor dem PR).
   */
  standAbruf: AbrufZustand;
  vorbereitung: Vorbereitung;
  onVerlassen: () => void;
}

/**
 * Lagebesprechung im Großbild (LLH-1747, Spec `grossbild-ansicht`, „Inhalt des Großbilds in der
 * Lagebesprechung“; design.md D5 in `openspec/changes/ckl1wbvz-grossbild-lage/`).
 *
 * Oben der Termin mit seinem Zustand (dasselbe Wort und derselbe Ton wie im Paneel „Termin“, Regel
 * „Überfälliger Besprechungstermin“ in `lagebesprechung/AGENTS.md`) und die Zahl der
 * abgeschlossenen Besprechungen. Darunter die Zeilen der Vorbereitung aus `useVorbereitung`, in
 * ihrer Reihenfolge, spaltenweise auf drei Spalten, je Zeile Bezeichnung, Wert direkt daneben und
 * Notiz darunter. Die Quelle bleibt in der normalen Ansicht und in der Übernahme.
 */
export default function LagebesprechungGrossbild({
  einsatz,
  stand,
  standAbruf,
  vorbereitung,
  onVerlassen,
}: LagebesprechungGrossbildProps) {
  const { rollen } = useRollen();
  // `gesperrt` gibt es hier nicht: die Seite prüft ihre eigene Freigabe.
  const standZustand: GrossZustand =
    standAbruf === 'laden' || standAbruf === 'fehler' ? standAbruf : 'daten';
  const { konventionen: konv } = useAnzeigeKonventionen();
  // 5-s-Takt wie im Lagebild: „Stand vor n s“ läuft mit, ohne jede Sekunde zu rendern.
  const jetzt = useUhr(5_000);
  const termin = stand?.naechste_lagebesprechung_at;
  const darstellung = lagebesprechungZustand(termin, jetzt);
  const { zeilen, standMs } = vorbereitung;
  // Uhrzeit und Alter des Stands wie im Lagebild: ohne Live-Kanal sieht man an der Wand, dass die
  // Zahlen alt werden (Spec „Dieselben Zahlen wie die Seite“: den Datenstand mit Alter nennen).
  const meta = `${lagebildZeit(jetzt.valueOf(), konv)} · ${standText(standMs, jetzt.valueOf(), konv)}`;
  const jeSpalte = Math.ceil(zeilen.length / SPALTEN);
  const spalten = Array.from({ length: SPALTEN }, (_, i) =>
    zeilen.slice(i * jeSpalte, (i + 1) * jeSpalte),
  );

  return (
    <GrossbildFlaeche
      titel={modulName('lagebesprechung')}
      meta={meta}
      einsatz={einsatz}
      onVerlassen={onVerlassen}
    >
      <div
        role="group"
        aria-label="Termin der nächsten Lagebesprechung"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          columnGap: grossMass(GROSS_BEZUG.luft),
          flexShrink: 0,
        }}
      >
        <GrossKennzahl
          titel="Nächste Lagebesprechung"
          zustand={standZustand}
          ton={darstellung.rolle === 'achtung' ? 'achtung' : 'neutral'}
          wert={termin ? <ZeitAnzeige wert={termin} rolle="kurz" /> : '—'}
          notiz={darstellung.label}
        />
        <GrossKennzahl
          titel="Abgeschlossen"
          zustand={standZustand}
          wert={stand?.anzahl_lagebesprechungen ?? 0}
          notiz={
            stand?.letzte_lagebesprechung
              ? `zuletzt Nr. ${stand.letzte_lagebesprechung.lfd_nr}`
              : 'noch keine'
          }
        />
      </div>
      <section
        aria-label="Vorbereitung"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: grossMass(GROSS_BEZUG.fuge),
          overflow: 'hidden',
        }}
      >
        <h2
          style={{
            margin: 0,
            paddingBottom: grossMass(10),
            borderBottom: `1px solid ${rollen.linie}`,
            display: 'flex',
            alignItems: 'baseline',
            gap: grossMass(20),
            fontSize: grossMass(GROSS_BEZUG.text),
            lineHeight: 1.2,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: rollen.gedaempft,
          }}
        >
          Vorbereitung
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SPALTEN}, minmax(0, 1fr))`,
            columnGap: grossMass(48),
            minHeight: 0,
          }}
        >
          {spalten.map((teil, i) => (
            <GrossZeilen key={i} beschriftung={`Vorbereitung, Spalte ${i + 1}`}>
              {teil.map((z) => (
                <GrossZeile
                  key={z.schluessel}
                  bezeichnung={z.titel}
                  wert={z.wert}
                  notiz={z.notiz}
                  art={ALS_ZAHL.test(z.wert) ? 'zahl' : 'wort'}
                />
              ))}
            </GrossZeilen>
          ))}
        </div>
      </section>
    </GrossbildFlaeche>
  );
}
