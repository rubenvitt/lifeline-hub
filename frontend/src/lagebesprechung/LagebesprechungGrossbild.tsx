import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
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
import { lagebesprechungZustand } from './lagebesprechungZustand';
import type { Vorbereitung } from './useVorbereitung';

/** Bis zu so vielen Zeichen bleibt ein Wert eine große Zahl; Längeres (Sichtung) steht als Wort. */
const ZAHL_HOECHSTENS_ZEICHEN = 11;

interface LagebesprechungGrossbildProps {
  einsatz: EinsatzAnzeige | undefined;
  stand: LagebesprechungStand | undefined;
  standZustand: GrossZustand;
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
 * ihrer Reihenfolge, spaltenweise auf zwei Spalten, je Zeile Bezeichnung, Wert direkt daneben und
 * Notiz darunter. Die Quelle bleibt in der normalen Ansicht und in der Übernahme.
 */
export default function LagebesprechungGrossbild({
  einsatz,
  stand,
  standZustand,
  vorbereitung,
  onVerlassen,
}: LagebesprechungGrossbildProps) {
  const { rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const jetzt = useUhr(30_000);
  const termin = stand?.naechste_lagebesprechung_at;
  const darstellung = lagebesprechungZustand(termin, jetzt);
  const { zeilen, standWire } = vorbereitung;
  const haelfte = Math.ceil(zeilen.length / 2);
  const spalten = [zeilen.slice(0, haelfte), zeilen.slice(haelfte)];

  return (
    <GrossbildFlaeche
      titel={modulName('lagebesprechung')}
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
          {standWire && (
            <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
              Stand {zeitKurz(standWire, konv)}
            </span>
          )}
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: grossMass(64),
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
                  art={z.wert.length <= ZAHL_HOECHSTENS_ZEICHEN ? 'zahl' : 'wort'}
                />
              ))}
            </GrossZeilen>
          ))}
        </div>
      </section>
    </GrossbildFlaeche>
  );
}
