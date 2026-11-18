import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen, useUhrDarstellung } from '../anzeige/AnzeigeKonventionenContext';
import type { AbrufZustand } from '../api/abrufZustand';
import { ABSCHNITT_OFFLINE } from '../components/instrument/ListenPaneel';
import { NICHT_FREIGEGEBEN } from '../pages/lage-dashboard/fuehrungsZahlen';
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
import { datenstandText } from '../components/Datenstand';
import { formatiereUhr } from '../anzeige/zeitDarstellung';
import { useOhneVerbindung } from '../offline/verbindung';
import { lagebesprechungZustand } from './lagebesprechungZustand';
import type { Vorbereitung } from './useVorbereitung';

/**
 * Was als große Zahl steht: Ziffern mit Trennern (Stärke „0/12/58//70“, Zeit „1430“) und „Nr. 3“.
 * Alles andere („keiner“, „kein Termin“, die Sichtung) steht als Wort, kleiner und umbrechend.
 */
const ALS_ZAHL = /^(Nr\. )?[\d\s.,:/+–—-]+$/;
/** Elf Zeilen in drei Spalten: vier Reihen passen bei 16:9 unter den Termin. */
const SPALTEN = 3;

/** Zustand der Termin-Abfrage, dazu „ohne Netz, nie geladen“ (`fetchStatus` `paused` ohne Daten). */
export type TerminAbruf = AbrufZustand | 'ohne-netz';

interface LagebesprechungGrossbildProps {
  einsatz: EinsatzAnzeige | undefined;
  stand: LagebesprechungStand | undefined;
  /**
   * Zustand der Termin-Abfrage: `abrufZustand`, nie `isLoading` (eine ohne Netz pausierte Abfrage
   * ist nicht `isLoading` und stünde sonst als „0 abgeschlossen“ da), und `ohne-netz`, wenn sie
   * ohne Daten pausiert: dann wäre „wird abgerufen“ gelogen (Review vor dem PR).
   */
  standAbruf: TerminAbruf;
  vorbereitung: Vorbereitung;
  onVerlassen: () => void;
}

/**
 * Lagebesprechung im Großbild (LLH-1747, Spec `grossbild-ansicht`, „Inhalt des Großbilds in der
 * Lagebesprechung“; design.md D5 in `openspec/changes/archive/2026-11-16-ckl1wbvz-grossbild-lage/`).
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
  const standZustand: GrossZustand =
    standAbruf === 'laden' || standAbruf === 'fehler' ? standAbruf : 'daten';
  // Gesperrt (ein 403 räumt die Daten, `raeumeNachRechteentzug`) oder ohne Netz nie geladen: „—“
  // mit Grund statt „0“ und „kein Termin“.
  const ohneStand =
    standAbruf === 'gesperrt'
      ? NICHT_FREIGEGEBEN
      : standAbruf === 'ohne-netz'
        ? ABSCHNITT_OFFLINE
        : null;
  const { konventionen: konv } = useAnzeigeKonventionen();
  const uhrArt = useUhrDarstellung();
  const ohneNetz = useOhneVerbindung();
  // 5-s-Takt: Uhr und Alter des Stands laufen mit, ohne jede Sekunde zu rendern.
  const jetzt = useUhr(5_000);
  const termin = stand?.naechste_lagebesprechung_at;
  const darstellung = lagebesprechungZustand(termin, jetzt);
  const { zeilen, standMs } = vorbereitung;
  // Uhr und Stand mit Alter wie im Großbild des Lagebilds (LLH-1750): ohne Live-Kanal sieht man an
  // der Wand, dass die Zahlen alt werden (Spec „Dieselben Zahlen wie die Seite“).
  const meta = `${formatiereUhr(jetzt.valueOf(), uhrArt)} · ${datenstandText(standMs, jetzt.valueOf(), { alter: true, offline: ohneNetz, konv })}`;
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
          ton={ohneStand == null && darstellung.rolle === 'achtung' ? 'achtung' : 'neutral'}
          wert={ohneStand == null && termin ? <ZeitAnzeige wert={termin} rolle="kurz" /> : '—'}
          notiz={ohneStand ?? darstellung.label}
        />
        <GrossKennzahl
          titel="Abgeschlossen"
          zustand={standZustand}
          wert={ohneStand != null ? '—' : (stand?.anzahl_lagebesprechungen ?? 0)}
          notiz={
            ohneStand ??
            (stand?.letzte_lagebesprechung
              ? `zuletzt Nr. ${stand.letzte_lagebesprechung.lfd_nr}`
              : 'noch keine')
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
