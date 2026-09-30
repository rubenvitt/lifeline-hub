import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { schlechtesterZustand, type AbrufZustand } from '../api/abrufZustand';
import { legeLageberichtAn } from '../api/lageberichte';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Stab } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag, taktischeDtgVoll } from '../anzeige/format';
import { Paneel, PaneelZeile, monoStil, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { auftragsStand, meldungsStand } from '../pages/lage-dashboard/fuehrungsZahlen';
import { baueLagebild, kennzahlReihe } from '../pages/lage-dashboard/lagebild';
import { standDer, useLagebild } from '../pages/lage-dashboard/useLagebild';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { quellenLaden, vorbereitungMarkdown, vorbereitungsZeilen } from './vorbereitung';

dayjs.extend(utc);

/** Takt der Uhr: die Notiz „n seit über 4 h" an „Vermisste" zieht nach, ohne jede Sekunde zu
 *  rendern. */
const TAKT_MS = 30_000;

/** Die Reihe ohne aktive Lagekennzahlen: Kern plus Füllplätze, nie Pegel oder Evakuiert. */
const KERN_REIHE = kennzahlReihe([]);

/** Epoche → Wire-String (UTC ohne Zone), wie die Formatierer ihn erwarten. */
function alsWire(ms: number): string {
  return dayjs.utc(ms).format('YYYY-MM-DD HH:mm:ss');
}

interface Props {
  einsatzId: number;
  einsatz: EinsatzAnzeige;
  benutzer: BenutzerAnzeige | null;
  overrides: ModulOverrides | undefined;
  stab: Stab | undefined;
  stabZustand: AbrufZustand;
  stabStand: number;
}

/**
 * Paneel „Vorbereitung" der Stab-Seite (LFH-550): der Lagestand zur nächsten Lagebesprechung.
 *
 * Die Zahlen kommen aus DERSELBEN Zusammenstellung wie das Lage-Dashboard (`useLagebild` +
 * `baueLagebild`) und aus dem Modulzähler — das Paneel rechnet nichts selbst
 * (`stab/vorbereitung.ts`). Jede Zeile nennt ihre Quelle; eine gesperrte Quelle steht als „—" mit
 * Grund da. Nichts wird gespeichert: einen festen Stand gibt es nur über „In Lagebericht
 * übernehmen" (EIN Aufruf mit Startinhalt, Spec `dokument-uebernahme`).
 */
export default function VorbereitungPaneel({
  einsatzId,
  einsatz,
  benutzer,
  overrides,
  stab,
  stabZustand,
  stabStand,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const navigate = useNavigate();
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), TAKT_MS);
    return () => window.clearInterval(t);
  }, []);

  const { q, zustand, basis } = useLagebild(einsatzId, { mitPegel: false });
  // Die Lageplätze (Pegel, Evakuiert) zeigt die Vorbereitung nicht: sie baut mit der Reihe ohne
  // Lagekennzahlen, die Kern-Kennzahlen sind dieselben wie im Dashboard.
  const lagebild = useMemo(
    () =>
      basis
        ? baueLagebild({ ...basis, evakuierung: { zustand: 'laden' } }, jetzt, konv, KERN_REIHE)
        : null,
    [basis, jetzt, konv],
  );

  const zeilen = vorbereitungsZeilen(
    {
      lagebild,
      zustand: {
        personen: zustand.personen,
        kraefte: schlechtesterZustand(
          zustand.abschnitte,
          zustand.einheiten,
          zustand.personal,
          zustand.fahrzeuge,
          zustand.material,
        ),
        gefahren: zustand.gefahren,
        lageberichte: zustand.lageberichte,
        stab: stabZustand,
      },
      auftraege: auftragsStand(q.zaehler),
      meldungen: meldungsStand(q.zaehler),
      stab,
    },
    konv,
  );

  const stand = Math.min(
    ...[
      standDer(
        q.einsatz,
        q.personen,
        q.personal,
        q.fahrzeuge,
        q.material,
        q.einheiten,
        q.abschnitte,
        q.gefahren,
        q.lageberichte,
        q.zaehler,
      ),
      stabStand,
    ].filter((s) => s > 0),
  );
  const standWire = Number.isFinite(stand) ? alsWire(stand) : null;
  const laedt = quellenLaden(zeilen);

  // Die Übernahme legt einen Lagebericht an: Schreibrecht im Einsatz UND Modul Lageberichte frei.
  // Solange eine Quelle lädt, stünde „lädt" im Bericht — der Knopf ist dann gesperrt.
  const darfUebernehmen =
    darfImEinsatzSchreiben(einsatz, benutzer) &&
    overrides != null &&
    istKeyFreigegeben('lageberichte', benutzer, overrides);

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const titelDtg = taktischeDtgVoll(new Date().toISOString(), konv);
      const standDtg = standWire ? taktischeDtgVoll(standWire, konv) : titelDtg;
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Vorbereitung Lagebesprechung ${titelDtg}`,
        abschnitte: [{ schluessel: 'text', text: vorbereitungMarkdown(zeilen, standDtg) }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
  });

  return (
    <Paneel
      titel="Vorbereitung"
      meta={standWire ? `Stand ${formatUhrzeitMitTag(standWire, konv)}` : undefined}
      style={{ marginBottom: token.margin }}
      fuss={
        darfUebernehmen || uebernehmen.error != null ? (
          <div style={{ padding: `${token.paddingSM}px ${token.padding}px` }}>
            {darfUebernehmen && (
              <Button
                loading={uebernehmen.isPending}
                disabled={laedt}
                title={laedt ? 'Erst wenn alle Angaben geladen sind' : undefined}
                onClick={() => uebernehmen.mutate()}
              >
                In Lagebericht übernehmen
              </Button>
            )}
            {uebernehmen.error != null && (
              <div style={{ marginBlockStart: token.marginSM }}>
                <SpeicherFehler
                  fehler={uebernehmen.error}
                  titel="Nicht in den Lagebericht übernommen"
                  fallback="Übernahme fehlgeschlagen"
                />
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {zeilen.map((z) => (
        <PaneelZeile key={z.schluessel}>
          <div
            data-lfh="vorbereitung-zeile"
            data-schluessel={z.schluessel}
            data-zustand={z.zustand}
            style={{
              display: 'grid',
              // Beide Spalten dürfen schrumpfen: die Sichtung ist lang und bricht an ihren
              // Trennern um, statt auf 390 px über den Rand zu laufen.
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)',
              columnGap: token.marginSM,
              rowGap: token.marginXXS,
              width: '100%',
            }}
          >
            <span>{z.titel}</span>
            <span
              data-teil="wert"
              style={{
                ...monoStil(token.fontSize, 500),
                textAlign: 'end',
                overflowWrap: 'anywhere',
              }}
            >
              {z.wert}
            </span>
            <span style={{ color: rollen.gedaempft, fontSize: token.fontSizeSM }}>
              {z.notiz ?? ''}
            </span>
            <span style={{ color: rollen.gedaempft, fontSize: token.fontSizeSM, textAlign: 'end' }}>
              Quelle: {z.quelle}
            </span>
          </div>
        </PaneelZeile>
      ))}
    </Paneel>
  );
}
