/**
 * Die drei Paneele des Lage-Dashboards (Neuentwurf S3): Gefahrenmatrix · Sichtung ·
 * Meldungsstrom. Rein darstellend — Abfragen, Zustände und die Wassermarke des Stroms hält
 * die Seite (`LageDashboardPage.tsx`), die Ableitungen liegen in `lageVerdichtung.ts` und
 * `meldungsstrom.ts`.
 */
import type { CSSProperties } from 'react';
import type { EtbEintragAnzeige, Sichtungskategorie } from '../../api/types';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import {
  Paneel,
  PaneelLink,
  PaneelZustand,
  Sammelbanner,
  Zeitachseneintrag,
  monoStil,
  useRollen,
} from '../../components/instrument';
import type { LiveVerbindungsStatus } from '../../live/useEinsatzLiveStream';
import { etbTyp, sichtung, warnstufeBalkenFarbe } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import { WARNSTUFE_RANG, type GefahrenZeile, type SichtungsZeile } from './lageVerdichtung';
import { warnstufeTon, type Datenzustand } from './lagebild';
import { bannerText, stromQuelle, stromZeit } from './meldungsstrom';
import { MATRIX_KLASSE } from './matrixGeometrie';
import './gefahrenmatrix.css';

/** Im Fugenraster trägt das Raster die Linien — ein eigener Paneelrahmen verdoppelte sie. */
const IM_RASTER: CSSProperties = { border: 'none', minHeight: 0 };

const LEGENDE = ['niedrig', 'mittel', 'hoch', 'akut'] as const;

export function GefahrenmatrixPaneel({
  zustand,
  zeilen,
  unbewertet,
  gebiete,
  onNeuladen,
  onGefahren,
}: {
  zustand: Datenzustand;
  zeilen: GefahrenZeile[];
  unbewertet: number;
  gebiete: number;
  onNeuladen: () => void;
  onGefahren: () => void;
}) {
  const { token, rollen } = useRollen();
  const leerText =
    gebiete === 0 ? 'Noch keine Gefahrengebiete angelegt.' : 'Noch keine Gefahr bewertet.';
  return (
    <Paneel
      titel="Gefahrenmatrix"
      meta={zustand === 'daten' ? `${gebiete} ${gebiete === 1 ? 'Gebiet' : 'Gebiete'}` : undefined}
      aktion={<PaneelLink label="Gefahren" onKlick={onGefahren} />}
      fuss={
        zustand === 'daten' && unbewertet > 0 ? (
          <span style={{ ...monoStil(11), color: rollen.schwach }}>
            {unbewertet} Gefahrentypen unbewertet
          </span>
        ) : undefined
      }
      style={IM_RASTER}
    >
      <PaneelZustand
        zustand={zustand}
        titel="Gefahrenmatrix"
        leerText={leerText}
        leerAktion="Gefahren bewerten"
        onLeerAktion={onGefahren}
        onNeuladen={onNeuladen}
      >
        <div
          className={MATRIX_KLASSE.wurzel}
          style={{ padding: token.padding, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {zeilen.map((z) => {
              const farbe = warnstufeBalkenFarbe(z.stufe, token);
              const rang = WARNSTUFE_RANG[z.stufe];
              const ton = warnstufeTon(z.stufe);
              return (
                <li
                  key={z.typ}
                  data-lfh="gefahrenzeile"
                  data-stufe={z.stufe}
                  className={MATRIX_KLASSE.zeile}
                  style={{ gap: token.paddingSM }}
                >
                  {/* Silbentrennung statt Bruch an beliebiger Stelle: „Erkrankung/Verletzung"
                      bräche sonst als „…/Verl|etzung" (`lang="de"` steht in index.html). */}
                  <span
                    style={{
                      fontSize: 12,
                      color: rollen.text2,
                      hyphens: 'auto',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {z.label}
                  </span>
                  {/* Dekoration neben dem Wort — der zweite Kanal ist das Stufenwort rechts. */}
                  <span
                    aria-hidden="true"
                    data-lfh="gefahrenbalken"
                    className={MATRIX_KLASSE.stufen}
                    style={{ height: 14 }}
                  >
                    {LEGENDE.map((_, i) => (
                      <span
                        key={i}
                        data-voll={i < rang ? 'ja' : 'nein'}
                        style={{ background: i < rang && farbe ? farbe : rollen.flaeche3 }}
                      />
                    ))}
                  </span>
                  <span
                    style={{
                      ...monoStil(11),
                      textAlign: 'end',
                      color:
                        ton === 'alarm'
                          ? rollen.alarmText
                          : ton === 'achtung'
                            ? rollen.achtungText
                            : rollen.gedaempft,
                    }}
                  >
                    {z.stufe}
                  </span>
                </li>
              );
            })}
          </ul>
          {/* Legende in DERSELBEN Geometrie wie die Balken (`matrixGeometrie.ts`): jedes
              Wort steht mittig unter seinem Segment. */}
          <div
            aria-hidden="true"
            data-lfh="gefahrenlegende"
            className={`${MATRIX_KLASSE.zeile} ${MATRIX_KLASSE.legende}`}
            style={{
              gap: token.paddingSM,
              paddingTop: 6,
              borderTop: `1px solid ${rollen.linie}`,
            }}
          >
            <span className={MATRIX_KLASSE.fueller} />
            <span
              className={MATRIX_KLASSE.stufen}
              style={{ ...monoStil(10), color: rollen.schwach }}
            >
              {LEGENDE.map((l) => (
                <span
                  key={l}
                  style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}
                >
                  {l}
                </span>
              ))}
            </span>
            <span className={MATRIX_KLASSE.fueller} />
          </div>
        </div>
      </PaneelZustand>
    </Paneel>
  );
}

/**
 * Beschreibung je Sichtungskategorie (BBK, Triage/Sichtung). Das Kürzel und die Farbe
 * kommen aus dem Vertrag (`sichtung`, `sichtungsfarben`), die Beschreibung ist Satz.
 */
const SICHTUNG_BESCHREIBUNG: Record<Sichtungskategorie, string> = {
  sk1: 'akute vitale Bedrohung',
  sk2: 'schwer verletzt / erkrankt',
  sk3: 'leicht verletzt / erkrankt',
  sk4: 'ohne Überlebenschance',
  tot: 'verstorben',
  unverletzt: 'nicht verletzt',
};

export function SichtungsPaneel({
  zustand,
  zeilen,
  erfasst,
  ohneSichtung,
  transport,
  onNeuladen,
  onPersonen,
  onAufnehmen,
}: {
  zustand: Datenzustand;
  zeilen: SichtungsZeile[];
  erfasst: number;
  ohneSichtung: number;
  /** „Transportiert / offen" aus `transportBilanz` (LFH-613). */
  transport: { transportiert: number; offen: number };
  onNeuladen: () => void;
  onPersonen: () => void;
  onAufnehmen: () => void;
}) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel="Sichtung"
      meta={zustand === 'daten' ? `${erfasst} erfasst` : undefined}
      aktion={<PaneelLink label="Personen" onKlick={onPersonen} />}
      // Fuß: „Ohne Sichtung" und „Transportiert / offen" (LFH-613,
      // `personenBilanz.transportBilanz` — gezählt nach Verbleib-Art, eine Voranmeldung ist
      // kein Transport; „offen" ist dieselbe Lücke wie auf der Betroffenen-Seite).
      // „Ohne Sichtung" steht seit LFH-650 IMMER, auch mit 0: kam und ging die Zeile live mit
      // dem Wert, schob sie die Transport-Zeile und das ganze Paneel mit (Prüfliste LFH-613,
      // Tabelle 5, Nr. 12). Eine 0 ist hier eine Aussage — alle Erfassten sind gesichtet.
      fuss={
        zustand === 'daten' ? (
          <span style={{ display: 'grid', gap: token.paddingXS }}>
            <span
              data-lfh="ohne-sichtung"
              style={{ display: 'flex', justifyContent: 'space-between', gap: token.paddingSM }}
            >
              <span style={{ fontSize: 11, color: rollen.schwach }}>Ohne Sichtung</span>
              <span style={{ ...monoStil(12), color: rollen.text2 }}>{ohneSichtung}</span>
            </span>
            <span
              data-lfh="transport-bilanz"
              style={{ display: 'flex', justifyContent: 'space-between', gap: token.paddingSM }}
            >
              <span style={{ fontSize: 11, color: rollen.schwach }}>Transportiert / offen</span>
              <span style={{ ...monoStil(12), color: rollen.text2 }}>
                {transport.transportiert} / {transport.offen}
              </span>
            </span>
          </span>
        ) : undefined
      }
      style={IM_RASTER}
    >
      <PaneelZustand
        zustand={zustand}
        titel="Sichtung"
        leerText="Noch keine Personen erfasst."
        leerAktion="Person aufnehmen"
        onLeerAktion={onAufnehmen}
        onNeuladen={onNeuladen}
      >
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: token.padding,
            display: 'grid',
            gap: 14,
          }}
        >
          {zeilen.map((z) => {
            const darstellung = sichtung[z.kategorie];
            const farbe = darstellung.farbe ? sichtungsfarben[darstellung.farbe] : null;
            return (
              <li
                key={z.kategorie}
                data-sichtung={z.kategorie}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: token.paddingSM,
                  }}
                >
                  {/* Das Kürzel steht in Textfarbe, die BBK-Farbe im umrandeten Farbfeld
                      davor (Muster `SichtungsTag`): Gelb auf hellem und Schwarz auf dunklem
                      Grund wären als Schrift unlesbar, und Schwarz färbt nie Text. */}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      ...monoStil(12),
                      letterSpacing: '0.06em',
                      color: rollen.text,
                    }}
                  >
                    {farbe && (
                      <span
                        aria-hidden="true"
                        data-lfh="sichtungsfeld"
                        style={{
                          width: 9,
                          height: 9,
                          background: farbe,
                          border: `1px solid ${token.colorText}`,
                        }}
                      />
                    )}
                    {darstellung.label}
                  </span>
                  <span style={{ flex: '1 1 auto', fontSize: 11, color: rollen.schwach }}>
                    {SICHTUNG_BESCHREIBUNG[z.kategorie]}
                  </span>
                  <span
                    data-lfh="sichtung-wert"
                    style={{ ...monoStil(20, 500), color: rollen.text }}
                  >
                    {z.wert}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  style={{ display: 'flex', height: 6, background: rollen.flaeche3 }}
                >
                  <span
                    data-lfh="sichtung-anteil"
                    style={{
                      width: `${Math.round(z.anteil * 1000) / 10}%`,
                      background: farbe ?? rollen.gedaempft,
                      // Schwarz auf der dunklen Spur verschwände — die Kontur hält ihn sichtbar.
                      boxShadow:
                        darstellung.farbe === 'schwarz'
                          ? `inset 0 0 0 1px ${rollen.gedaempft}`
                          : undefined,
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </PaneelZustand>
    </Paneel>
  );
}

/** Wortlaut je Verbindungszustand — `Record` über die volle Union, damit eine fünfte
 *  Variante den Build bricht. `idle` ist „noch nicht offen", nicht „live" (LFH-336 · M3). */
const VERBINDUNG: Record<LiveVerbindungsStatus, string> = {
  idle: 'Verbindung wird aufgebaut',
  open: 'live',
  connecting: 'Verbindung wird aufgebaut',
  lost: 'Verbindung unterbrochen',
};

export function MeldungsstromPaneel({
  zustand,
  sichtbar,
  neu,
  neuMindestens,
  liveStatus,
  konv,
  onAnzeigen,
  onNeuladen,
  onEtb,
  onErfassen,
}: {
  zustand: Datenzustand;
  sichtbar: EtbEintragAnzeige[];
  neu: number;
  neuMindestens: boolean;
  liveStatus: LiveVerbindungsStatus;
  konv: AnzeigeKonventionen;
  onAnzeigen: () => void;
  onNeuladen: () => void;
  onEtb: () => void;
  onErfassen: () => void;
}) {
  const { rollen } = useRollen();
  // „live" nur bei offener Leitung — bei totem Stream liefert der Cache brav alte Daten,
  // und ein stehengebliebenes „live" wäre genau die Falschaussage, gegen die LFH-336 antrat.
  const metaFarbe =
    liveStatus === 'open'
      ? rollen.bedien
      : liveStatus === 'lost'
        ? rollen.alarmText
        : rollen.schwach;
  return (
    <Paneel
      titel="Meldungsstrom"
      meta={
        <span data-lfh="strom-live" style={{ color: metaFarbe }}>
          {VERBINDUNG[liveStatus]}
        </span>
      }
      aktion={<PaneelLink label="ETB" onKlick={onEtb} />}
      style={IM_RASTER}
    >
      <PaneelZustand
        zustand={zustand}
        titel="Meldungsstrom"
        leerText="Noch keine Einträge im Einsatztagebuch."
        leerAktion="Eintrag erfassen"
        onLeerAktion={onErfassen}
        onNeuladen={onNeuladen}
      >
        {neu > 0 && (
          <Sammelbanner aktion={{ label: 'anzeigen', onKlick: onAnzeigen }}>
            {bannerText(neu, neuMindestens)}
          </Sammelbanner>
        )}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sichtbar.map((e) => (
            <Zeitachseneintrag
              key={e.id}
              als="li"
              data-lfd-nr={e.lfd_nr}
              zeit={stromZeit(e, konv)}
              nr={`Nr. ${e.lfd_nr}`}
              typ={e.typ}
              typwort={etbTyp[e.typ].label}
              meta={stromQuelle(e)}
            >
              <span
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
                title={e.inhalt}
              >
                {e.inhalt}
              </span>
            </Zeitachseneintrag>
          ))}
        </ol>
      </PaneelZustand>
    </Paneel>
  );
}
