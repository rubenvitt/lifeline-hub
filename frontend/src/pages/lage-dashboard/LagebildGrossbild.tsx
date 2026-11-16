import type { ReactNode } from 'react';
import type { EinsatzAnzeige } from '../../api/types';
import {
  GROSS_BEZUG,
  GROSS_FEHLER,
  GROSS_LADEN,
  GrossKennzahl,
  GrossZeile,
  GrossZeilen,
  GrossbildFlaeche,
  grossMass,
} from '../../components/grossbild';
import { useRollen } from '../../components/instrument';
import { modulName } from '../../einsatz/modulRegistry';
import { sichtung, warnstufeBalkenFarbe } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import { NICHT_FREIGEGEBEN } from './fuehrungsZahlen';
import type { KennzahlAnzeige } from './kennzahlAnzeige';
import { KENNZAHL_PLAETZE, warnstufeTon, type Quellzustand } from './lagebild';
import { WARNSTUFE_RANG, type GefahrenZeile, type SichtungsZeile } from './lageVerdichtung';
import { VERLAUF_STUNDEN, type Verlauf } from './verlauf';

/** So viele Gefahrentypen passen bei 1920 × 1080 unter das Band; der Rest steht als „+ n weitere“. */
export const GEFAHREN_HOECHSTENS = 5;
/**
 * So viele Stunden des Verlaufs, jüngste zuerst. Fünf Zeilen samt „Spitze …“ ragten bei 16:9 um
 * rund 16 px über die untere Reihe (Review vor dem PR).
 */
const VERLAUF_ZEILEN = 4;
/** Zeilen eines Hinweissatzes; Gebietsnamen dürfen 200 Zeichen lang sein. */
const SATZ_HOECHSTENS_ZEILEN = 2;
/** Ab so vielen Sichtungszeilen zwei Spaltenpaare, damit nichts unten abreißt. */
const SICHTUNG_EINSPALTIG_HOECHSTENS = 5;
/** Längere Werte (Stärke „0/12/58//70“) stehen in der kleinen Zahl, sonst sprengen sie die Spalte. */
const LANG_AB_ZEICHEN = 7;

interface LagebildGrossbildProps {
  einsatz: EinsatzAnzeige | undefined;
  /** Uhrzeit des Lagebilds und Datenstand, wie im Seitenkopf. */
  meta: string;
  /** `null`, solange das Lagebild noch nicht steht. */
  kennzahlen: KennzahlAnzeige[] | null;
  sanitaetsdienst: boolean;
  gefahren: {
    zustand: Quellzustand;
    zeilen: readonly GefahrenZeile[];
    gebiete: number;
    beurteilung: string | null;
  };
  verlauf: { zustand: Quellzustand; verlauf: Verlauf };
  sichtung: {
    zustand: Quellzustand;
    zeilen: readonly SichtungsZeile[];
    erfasst: number;
    ohneSichtung: number;
  };
  fuehrung: readonly KennzahlAnzeige[];
  onVerlassen: () => void;
}

/**
 * Lagebild im Großbild (LLH-1747, Spec `grossbild-ansicht`, „Inhalt des Großbilds im Lagebild“;
 * design.md D5 in `openspec/changes/ckl1wbvz-grossbild-lage/`).
 *
 * Die Seite reicht ihre schon berechneten Werte herein, das Großbild rechnet nichts selbst: das Band
 * und der Führungsstand kommen als {@link KennzahlAnzeige} aus `kennzahlAnzeige.ts`, Gefahren,
 * Sichtung und Verlauf aus denselben Verdichtungen wie die Paneele. Aufteilung bei 16:9: das Band in
 * drei Spalten und zwei Reihen, darunter Gefahren (oder der Verlauf in der Reihe
 * „Sanitätsdienst“), Sichtung und Führungsstand. Der Meldungsstrom fehlt: ETB-Text ist aus 3 m
 * kein Lagewert.
 */
export default function LagebildGrossbild({
  einsatz,
  meta,
  kennzahlen,
  sanitaetsdienst,
  gefahren,
  verlauf,
  sichtung: sichtungsDaten,
  fuehrung,
  onVerlassen,
}: LagebildGrossbildProps) {
  return (
    <GrossbildFlaeche
      titel={modulName('lage-dashboard')}
      meta={meta}
      einsatz={einsatz}
      onVerlassen={onVerlassen}
    >
      <div
        role="group"
        aria-label="Lage in Zahlen"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          columnGap: grossMass(GROSS_BEZUG.luft),
          rowGap: grossMass(GROSS_BEZUG.fuge),
          flexShrink: 0,
        }}
      >
        {kennzahlen == null
          ? Array.from({ length: KENNZAHL_PLAETZE }, (_, i) => (
              <GrossKennzahl key={i} titel={' '} wert="" zustand="laden" />
            ))
          : kennzahlen.map((k) => (
              <GrossKennzahl
                key={k.titel}
                titel={k.titel}
                wert={k.wert}
                einheit={k.einheit}
                notiz={k.notiz}
                ton={k.ton}
                zustand={k.zustand}
                groesse={String(k.wert).length >= LANG_AB_ZEICHEN ? 'zahlKlein' : 'zahl'}
              />
            ))}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr)',
          columnGap: grossMass(48),
        }}
      >
        {sanitaetsdienst ? <VerlaufBlock {...verlauf} /> : <GefahrenBlock {...gefahren} />}
        <SichtungsBlock {...sichtungsDaten} />
        <Block titel="Führungsstand">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: grossMass(GROSS_BEZUG.luft),
              rowGap: grossMass(GROSS_BEZUG.fuge),
            }}
          >
            {fuehrung.map((k) => (
              <GrossKennzahl
                key={k.titel}
                titel={k.titel}
                wert={k.wert}
                notiz={k.notiz}
                ton={k.ton}
                zustand={k.zustand}
                groesse="zahlKlein"
              />
            ))}
          </div>
        </Block>
      </div>
    </GrossbildFlaeche>
  );
}

/** Ein Block der unteren Reihe: Überschrift (Augenbraue im Großbild) und Inhalt. */
function Block({
  titel,
  zusatz,
  children,
}: {
  titel: string;
  zusatz?: string;
  children: ReactNode;
}) {
  const { rollen } = useRollen();
  return (
    <section
      aria-label={titel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: grossMass(14),
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <h2
        style={{
          margin: 0,
          paddingBottom: grossMass(10),
          borderBottom: `1px solid ${rollen.linie}`,
          fontSize: grossMass(GROSS_BEZUG.text),
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: rollen.gedaempft,
        }}
      >
        {zusatz ? `${titel} · ${zusatz}` : titel}
      </h2>
      {children}
    </section>
  );
}

/**
 * Satz statt Inhalt, wenn ein Block nichts zeigen kann (nie eine 0), oder ein Hinweis darunter. Mit
 * `zeilen` endet ein langer Satz mit „…“, der ganze Text steht im `title` und im DOM: sonst schnitte
 * der Block ihn unten still ab.
 */
function Satz({ children, ton, zeilen }: { children: string; ton?: 'achtung'; zeilen?: number }) {
  const { rollen } = useRollen();
  return (
    <span
      title={zeilen != null ? children : undefined}
      style={{
        fontSize: grossMass(GROSS_BEZUG.text),
        lineHeight: 1.2,
        color: ton === 'achtung' ? rollen.achtungText : rollen.gedaempft,
        ...(zeilen != null && {
          display: '-webkit-box',
          WebkitLineClamp: zeilen,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }),
      }}
    >
      {children}
    </span>
  );
}

function zustandsSatz(z: Quellzustand, leer: string): string | null {
  switch (z) {
    case 'laden':
      return GROSS_LADEN;
    case 'fehler':
      return GROSS_FEHLER;
    case 'gesperrt':
      return NICHT_FREIGEGEBEN;
    case 'leer':
      return leer;
    case 'daten':
      return null;
  }
}

function GefahrenBlock({
  zustand,
  zeilen,
  gebiete,
  beurteilung,
}: LagebildGrossbildProps['gefahren']) {
  const { token } = useRollen();
  const satz = zustandsSatz(zustand, 'Keine Gefahren bewertet.');
  // Absteigend nach Warnstufe; bei Gleichstand bleibt die Folge der Matrix.
  const geordnet = [...zeilen].sort((a, b) => WARNSTUFE_RANG[b.stufe] - WARNSTUFE_RANG[a.stufe]);
  const gezeigt = geordnet.slice(0, GEFAHREN_HOECHSTENS);
  const weitere = geordnet.length - gezeigt.length;
  return (
    <Block
      titel="Gefahren"
      zusatz={
        zustand === 'daten' ? `${gebiete} ${gebiete === 1 ? 'Gebiet' : 'Gebiete'}` : undefined
      }
    >
      {satz != null ? (
        <Satz>{satz}</Satz>
      ) : (
        <>
          <GrossZeilen beschriftung="Gefahren je Typ">
            {gezeigt.map((z) => {
              const ton = warnstufeTon(z.stufe);
              return (
                <GrossZeile
                  key={z.typ}
                  bezeichnung={z.label}
                  marke={warnstufeBalkenFarbe(z.stufe, token) ?? undefined}
                  wert={z.stufe}
                  art="wort"
                  ton={ton === 'alarm' || ton === 'achtung' ? ton : 'neutral'}
                />
              );
            })}
          </GrossZeilen>
          {weitere > 0 && <Satz>{`+ ${weitere} weitere`}</Satz>}
        </>
      )}
      {zustand === 'daten' && beurteilung && (
        <Satz ton="achtung" zeilen={SATZ_HOECHSTENS_ZEILEN}>
          {beurteilung}
        </Satz>
      )}
    </Block>
  );
}

function SichtungsBlock({
  zustand,
  zeilen,
  erfasst,
  ohneSichtung,
}: LagebildGrossbildProps['sichtung']) {
  const satz = zustandsSatz(zustand, 'Noch keine Personen erfasst.');
  const anzahl = zeilen.length + (ohneSichtung > 0 ? 1 : 0);
  return (
    <Block titel="Sichtung" zusatz={zustand === 'daten' ? `${erfasst} erfasst` : undefined}>
      {satz != null ? (
        <Satz>{satz}</Satz>
      ) : (
        <GrossZeilen
          beschriftung="Sichtung je Kategorie"
          spalten={anzahl > SICHTUNG_EINSPALTIG_HOECHSTENS ? 2 : 1}
        >
          {zeilen.map((z) => {
            const darstellung = sichtung[z.kategorie];
            return (
              <GrossZeile
                key={z.kategorie}
                bezeichnung={darstellung.label}
                marke={darstellung.farbe ? sichtungsfarben[darstellung.farbe] : undefined}
                wert={z.wert}
              />
            );
          })}
          {ohneSichtung > 0 && <GrossZeile bezeichnung="ohne Sichtung" wert={ohneSichtung} />}
        </GrossZeilen>
      )}
    </Block>
  );
}

function VerlaufBlock({ zustand, verlauf }: LagebildGrossbildProps['verlauf']) {
  const leer = zustand === 'daten' && verlauf.imFenster === 0 ? 'leer' : zustand;
  const satz = zustandsSatz(leer, `Keine Kontakte in den letzten ${VERLAUF_STUNDEN} Stunden.`);
  const juengste = [...verlauf.stunden].reverse().slice(0, VERLAUF_ZEILEN);
  return (
    <Block titel="Verlauf" zusatz={zustand === 'daten' ? `${VERLAUF_STUNDEN} h` : undefined}>
      {satz != null ? (
        <Satz>{satz}</Satz>
      ) : (
        <>
          <GrossZeilen beschriftung="Kontakte je Stunde">
            {juengste.map((s) => (
              <GrossZeile
                key={s.stunde}
                bezeichnung={s.laufend ? `${s.stunde} Uhr · laufend` : `${s.stunde} Uhr`}
                wert={s.gesamt}
              />
            ))}
          </GrossZeilen>
          {verlauf.spitze && (
            <Satz>{`Spitze ${verlauf.spitze.stunde} Uhr · ${verlauf.spitze.gesamt}`}</Satz>
          )}
        </>
      )}
    </Block>
  );
}
