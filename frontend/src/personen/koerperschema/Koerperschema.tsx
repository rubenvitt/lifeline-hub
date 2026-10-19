import { Button, Flex, Form, Typography } from 'antd';
import type { UseMutationResult } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { VerletzungEingabe } from '../../api/einsatzPerson';
import type {
  Person,
  Verletzung,
  VerletzungAnsicht,
  VerletzungArt,
  VerletzungSchwere,
} from '../../api/types';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { Segmentleiste, monoStil, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import BestaetigtVonFeld, { BESTAETIGT_FELD } from '../../geraet/BestaetigtVonFeld';
import FlaechenWahl from '../FlaechenWahl';
import KoerperFigur, { type KoerperZiel } from './KoerperFigur';
import { RAHMEN, figurMassstab, normiere, sternLage, zoneVon } from './geometrie';
import {
  WAHL_MIN_PX,
  figurVon,
  nummeriere,
  regionName,
  schemaLayout,
  type NummerierteVerletzung,
} from './koerperschemaKern';
import { VERLETZUNG_ART_REIHE, VERLETZUNG_ART_WORT, VERLETZUNG_SCHWERE_WORT } from '../personMeta';

/**
 * Der Baustein „Körperschema“ (LLH-1120, Spec `koerperschema`, design.md D13): Verletzungen einer
 * Person auf einer Figur nach Geschlecht, vorn und hinten, mit nummerierten Sternchen und der
 * Liste als zweitem Kanal daneben.
 *
 * MARKIEREN MIT ZWEI TIPPS: der erste Tipp auf eine Region öffnet daneben die Wahl der Art als
 * Flächen (`FlaechenWahl`), der zweite auf eine Fläche speichert, mit der Tippstelle als Lage
 * (`sternLage`: außerhalb der Silhouette der Mittelpunkt der Region). Die Schwere ist optional und
 * steht als Segmentleiste über den Flächen; sie kostet keinen Pflichttipp. Ein Tipp auf ein
 * Sternchen bietet „Aufheben“ an, der zweite hebt auf. Eine Ablehnung bleibt am Schema stehen, die
 * Wahl offen; Einhängen und Abbrechen räumen sie (LFH-1077). Jede Region beginnt ohne Schwere.
 * Nach Speichern, Aufheben und Abbrechen kehrt der Fokus an die Region bzw. das Sternchen zurück.
 *
 * LAYOUT nach der gemessenen Breite (`schemaLayout`): vorn und hinten stehen nur nebeneinander,
 * wenn die Spalte daneben mitpasst, sonst eine Ansicht mit Umschaltung. Die Wahl der Art steht
 * neben der Figur und klebt unter dem Rahmen, damit sie nach dem Tipp ohne Bildlauf im Bild steht,
 * auch in der Handschuh-Stufe am Tablet; reicht die Breite nicht einmal dafür, steht sie darunter
 * und rückt nach dem Tipp ins Bild. Die Figur schrumpft beim Markieren nie unter ihren Maßstab,
 * sie rollt waagerecht (Trefferzonen halten die Stufe).
 *
 * Die Mutationen hält der Aufrufer (Patientenkopf: Wechselsperre, ein Schreibweg je Handlung);
 * am UHS-Gerät nennt `BestaetigtVonFeld` die bestätigende Person.
 *
 * LESEN UND DRUCK zeigen Figur und Liste ohne Bedienung; der Druck zeichnet ohne Fläche in
 * `currentColor` (schwarz auf weiß), vorn und hinten immer nebeneinander.
 */
export interface KoerperschemaProps {
  einsatzId: number;
  verletzungen: readonly Verletzung[];
  geschlecht: Person['geschlecht'] | undefined;
  modus: 'lesen' | 'markieren' | 'druck';
  /** Grund, warum das Markieren gesperrt ist; das Schema bleibt lesbar. */
  gesperrt?: string;
  /**
   * Grund, warum nur das Aufheben gesperrt ist (ohne Netz, LLH-1138): Markieren merkt vor, das
   * Aufheben hat keine `client_id` und bleibt online.
   */
  aufhebenGesperrt?: string;
  markierung?: UseMutationResult<unknown, Error, VerletzungEingabe>;
  aufhebung?: UseMutationResult<unknown, Error, number>;
}

/** Pixel je Einheit beim Lesen und im Druck (240 × 352 bzw. 225 × 330 px je Ansicht). */
export const LESE_MASSSTAB = 0.8;
export const DRUCK_MASSSTAB = 0.75;

type Auswahl = { art: 'region'; ziel: KoerperZiel } | { art: 'stern'; id: number } | null;

const ANSICHTEN: readonly VerletzungAnsicht[] = ['vorn', 'hinten'];
const OHNE = 'ohne';
const SCHWERE_OPTIONEN = [
  { wert: OHNE, label: 'keine Angabe' },
  ...(Object.keys(VERLETZUNG_SCHWERE_WORT) as VerletzungSchwere[]).map((s) => ({
    wert: s,
    label: VERLETZUNG_SCHWERE_WORT[s],
  })),
] as const;
const ART_OPTIONEN = VERLETZUNG_ART_REIHE.map((a) => ({ wert: a, label: VERLETZUNG_ART_WORT[a] }));

/** „Kopf, vorn · Wunde/Blutung · schwer“ — Name, Art und Schwere einer Verletzung. */
export function verletzungText(v: Verletzung): string {
  const schwere = v.schwere ? ` · ${VERLETZUNG_SCHWERE_WORT[v.schwere]}` : '';
  return `${regionName(v.ansicht, v.region)} · ${VERLETZUNG_ART_WORT[v.art]}${schwere}`;
}

export default function Koerperschema({
  einsatzId,
  verletzungen,
  geschlecht,
  modus,
  gesperrt,
  aufhebenGesperrt,
  markierung,
  aufhebung,
}: KoerperschemaProps) {
  const { token, rollen } = useRollen();
  const abMd = useViewport().abBreite('md');
  const [einzelAnsicht, setEinzelAnsicht] = useState<VerletzungAnsicht>('vorn');
  const [auswahl, setAuswahl] = useState<Auswahl>(null);
  const [schwere, setSchwere] = useState<VerletzungSchwere | typeof OHNE>(OHNE);
  const [form] = Form.useForm<{ [BESTAETIGT_FELD]?: number }>();
  const sectionRef = useRef<HTMLElement>(null);
  const wahlRef = useRef<HTMLDivElement>(null);
  const width = useWidth(sectionRef);
  // Ziel des Fokus nach Speichern, Aufheben oder Abbrechen (ein Selektor im Schema): das
  // Bedienelement darunter hängt aus, und der Fokus fiele sonst auf `<body>`.
  const [fokusNach, setFokusNach] = useState<string | null>(null);

  // Einhängen räumt die Gründe der letzten Ablehnung (LFH-1077): der Patientenkopf hält die
  // Mutationen über ein Schließen des Paneels hinweg. Ref, damit ein neues Mutationsobjekt je
  // Render den Effekt nicht erneut auslöst; eine laufende Mutation bleibt unberührt.
  const mutationenRef = useRef({ markierung, aufhebung });
  mutationenRef.current = { markierung, aufhebung };
  useEffect(() => {
    for (const m of Object.values(mutationenRef.current)) {
      if (m && !m.isPending && m.error != null) m.reset();
    }
  }, []);

  useEffect(() => {
    if (fokusNach == null) return;
    sectionRef.current?.querySelector<SVGElement | HTMLElement>(fokusNach)?.focus();
    setFokusNach(null);
  }, [fokusNach]);

  // Nach dem Tipp steht die Wahl der Art im Bild: neben der Figur klebt sie, darunter rückt sie
  // nach (ohne zweite Geste). `scrollIntoView` fehlt in jsdom.
  const wahlOffen = auswahl?.art === 'region' ? auswahl.ziel.zone.region : null;
  useEffect(() => {
    if (wahlOffen != null) wahlRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [wahlOffen]);

  const figur = figurVon(geschlecht);
  const gueltige = nummeriere(verletzungen).filter((n) => n.verletzung.aufgehoben_at == null);
  const markieren = modus === 'markieren' && !gesperrt && markierung != null;
  const laeuft = (markierung?.isPending ?? false) || (aufhebung?.isPending ?? false);
  const massstab =
    modus === 'markieren'
      ? figurMassstab(token)
      : modus === 'druck'
        ? DRUCK_MASSSTAB
        : LESE_MASSSTAB;
  const layout =
    modus === 'druck'
      ? 'beide'
      : schemaLayout(
          width,
          {
            figurWidth: RAHMEN.breite * massstab,
            gapFiguren: token.marginSM,
            gapWahl: token.marginLG,
          },
          abMd,
        );
  const sichtbar = layout === 'beide' ? ANSICHTEN : [einzelAnsicht];
  const daneben = layout !== 'gestapelt';

  function waehleRegion(ziel: KoerperZiel) {
    if (laeuft) return;
    // Jede Region beginnt ohne Schwere: eine Wahl für die vorige wanderte sonst still mit.
    setSchwere(OHNE);
    setAuswahl({ art: 'region', ziel });
  }

  function abbrechenWahl() {
    if (auswahl?.art === 'region') setFokusNach(zoneSelektor(auswahl.ziel));
    setAuswahl(null);
    setSchwere(OHNE);
    if (markierung && !markierung.isPending && markierung.error != null) markierung.reset();
  }

  function abbrechenAngebot(nummer: number) {
    setFokusNach(`[data-lfh="stern"][data-nummer="${nummer}"]`);
    setAuswahl(null);
    if (aufhebung && !aufhebung.isPending && aufhebung.error != null) aufhebung.reset();
  }

  function speichern(art: VerletzungArt) {
    if (auswahl?.art !== 'region' || !markierung || laeuft) return;
    const { ziel } = auswahl;
    const lage = normiere(sternLage(ziel.zone, ziel.tipp, figur));
    const bestaetigt = form.getFieldValue(BESTAETIGT_FELD) as number | undefined;
    const eingabe: VerletzungEingabe = {
      ansicht: ziel.ansicht,
      region: ziel.zone.region,
      art,
      ...(schwere !== OHNE ? { schwere } : {}),
      ...lage,
      ...(bestaetigt != null ? { bestaetigt_personal_id: bestaetigt } : {}),
    };
    markierung.mutateAsync(eingabe).then(
      () => {
        setAuswahl(null);
        setSchwere(OHNE);
        setFokusNach(zoneSelektor(ziel));
      },
      // Die Ablehnung zeigt das Schema aus `markierung.error`; die Wahl bleibt offen.
      () => {},
    );
  }

  function aufheben(v: Verletzung) {
    if (!aufhebung || laeuft || aufhebenGesperrt) return;
    aufhebung.mutateAsync(v.id).then(
      () => {
        setAuswahl(null);
        // Das Sternchen ist weg: der Fokus geht an seine Region.
        const zone = zoneVon(v.ansicht, v.region);
        if (zone) setFokusNach(zoneSelektor({ ansicht: v.ansicht, zone }));
      },
      () => {},
    );
  }

  const gewaehlterStern = auswahl?.art === 'stern' ? auswahl.id : null;
  const stern =
    gewaehlterStern != null ? gueltige.find((n) => n.verletzung.id === gewaehlterStern) : undefined;

  return (
    <section
      ref={sectionRef}
      aria-label="Körperschema"
      data-lfh="koerperschema"
      data-layout={layout}
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
    >
      {layout !== 'beide' && (
        <Segmentleiste<VerletzungAnsicht>
          rolle="tablist"
          beschriftung="Ansicht"
          optionen={ANSICHTEN.map((a) => ({ wert: a, label: a }))}
          wert={einzelAnsicht}
          onWechsel={setEinzelAnsicht}
        />
      )}
      {modus === 'markieren' && gesperrt && (
        <div role="status" style={{ color: rollen.text2 }}>
          {gesperrt}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: daneben ? 'row' : 'column',
          gap: token.marginLG,
          alignItems: 'stretch',
        }}
      >
        <div
          data-lfh="koerperschema-figuren"
          style={{
            display: 'flex',
            gap: token.marginSM,
            flex: '0 0 auto',
            alignSelf: 'flex-start',
            // Breiter als der Platz (Handschuh am Handy): die Figur rollt, statt zu schrumpfen.
            maxWidth: '100%',
            overflowX: daneben ? undefined : 'auto',
          }}
        >
          {sichtbar.map((ansicht) => (
            <figure key={ansicht} style={{ margin: 0 }}>
              <KoerperFigur
                ansicht={ansicht}
                figur={figur}
                massstab={massstab}
                modus={modus === 'markieren' && !markieren ? 'lesen' : modus}
                sterne={gueltige.filter((n) => n.verletzung.ansicht === ansicht)}
                gewaehlt={
                  auswahl?.art === 'region' && auswahl.ziel.ansicht === ansicht
                    ? auswahl.ziel
                    : null
                }
                gewaehlterStern={gewaehlterStern}
                onRegion={waehleRegion}
                onStern={(id) => !laeuft && setAuswahl({ art: 'stern', id })}
              />
              <figcaption
                style={{ ...monoStil(12), color: rollen.gedaempft, textAlign: 'center' }}
                aria-hidden="true"
              >
                {ansicht}
              </figcaption>
            </figure>
          ))}
        </div>

        <div style={{ flex: `1 1 ${WAHL_MIN_PX}px`, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: token.marginSM,
              // Neben der Figur klebt die Spalte unter dem Rahmen: nach dem Tipp steht die Wahl im
              // Bild, auch wenn die Figur höher ist als das Fenster.
              ...(daneben && modus === 'markieren'
                ? { position: 'sticky' as const, top: 'var(--lfh-rahmen-oben, 0px)' }
                : {}),
            }}
          >
            {markieren && auswahl?.art === 'region' && (
              <Form form={form} layout="vertical" component="div">
                <div
                  ref={wahlRef}
                  role="group"
                  aria-label={`Verletzung an ${regionName(auswahl.ziel.ansicht, auswahl.ziel.zone.region)}`}
                  data-lfh="verletzung-wahl"
                  style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
                >
                  <Typography.Text strong>
                    {regionName(auswahl.ziel.ansicht, auswahl.ziel.zone.region)}
                  </Typography.Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                    <Typography.Text type="secondary">Schwere (optional)</Typography.Text>
                    <Segmentleiste<VerletzungSchwere | typeof OHNE>
                      beschriftung="Schwere (optional)"
                      optionen={SCHWERE_OPTIONEN}
                      wert={schwere}
                      onWechsel={setSchwere}
                    />
                  </div>
                  <FlaechenWahl<VerletzungArt>
                    aria-label="Art der Verletzung"
                    optionen={ART_OPTIONEN}
                    value={null}
                    disabled={laeuft}
                    onChange={speichern}
                  />
                  <BestaetigtVonFeld einsatzId={einsatzId} />
                  <div>
                    <Button disabled={laeuft} onClick={abbrechenWahl}>
                      Abbrechen
                    </Button>
                  </div>
                </div>
              </Form>
            )}
            {markieren && stern && (
              <div
                role="group"
                aria-label={`Verletzung ${stern.nummer}`}
                data-lfh="verletzung-angebot"
                style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
              >
                <Typography.Text strong>
                  <span style={monoStil(13)}>{stern.nummer}</span>{' '}
                  {verletzungText(stern.verletzung)}
                </Typography.Text>
                {aufhebenGesperrt && (
                  <div role="status" style={{ color: rollen.text2 }}>
                    {aufhebenGesperrt}
                  </div>
                )}
                <Flex gap="middle" wrap>
                  <Button
                    danger
                    disabled={!!aufhebenGesperrt}
                    loading={aufhebung?.isPending}
                    onClick={() => aufheben(stern.verletzung)}
                  >
                    Aufheben
                  </Button>
                  <Button disabled={laeuft} onClick={() => abbrechenAngebot(stern.nummer)}>
                    Abbrechen
                  </Button>
                </Flex>
              </div>
            )}
            {markierung?.error != null && (
              <SpeicherFehler fehler={markierung.error} titel="Verletzung nicht markiert" />
            )}
            {aufhebung?.error != null && (
              <SpeicherFehler fehler={aufhebung.error} titel="Verletzung nicht aufgehoben" />
            )}
            <VerletzungsListe eintraege={gueltige} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Selektor der Zone einer Region im Schema (Fokusziel). */
function zoneSelektor(ziel: Pick<KoerperZiel, 'ansicht' | 'zone'>): string {
  return `[data-lfh="koerperfigur"][data-ansicht="${ziel.ansicht}"] [data-lfh="koerperzone"][data-region="${ziel.zone.region}"]`;
}

/**
 * Die Breite des Elements in px, gemessen (`ResizeObserver`); `null`, solange nichts gemessen ist
 * (jsdom misst nie). Gemessen vor dem ersten Zeichnen, damit kein falsches Layout aufblitzt.
 */
function useWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const messen = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? w : null);
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [ref]);
  return width;
}

/** Die nummerierte Liste: Nummer, Region mit Seite und Ansicht, Art, Schwere, Uhrzeit. */
export function VerletzungsListe({ eintraege }: { eintraege: readonly NummerierteVerletzung[] }) {
  const { token } = useRollen();
  if (eintraege.length === 0) {
    return <Typography.Text type="secondary">keine Verletzungen</Typography.Text>;
  }
  return (
    <ol
      aria-label="Verletzungen"
      data-lfh="verletzungsliste"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXXS,
      }}
    >
      {eintraege.map(({ nummer, verletzung: v }) => (
        <li key={v.id}>
          <span style={{ ...monoStil(13, 500) }}>{nummer}</span> {verletzungText(v)} ·{' '}
          <span style={monoStil(13)}>
            <ZeitAnzeige wert={v.zeitpunkt_at} format="uhrzeit" />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Pixel je Einheit der kleinen Figur im Patientenkopf (90 × 132 px je Ansicht). */
export const MINI_MASSSTAB = 0.3;

/**
 * Die kleine Figur im Patientenkopf (design.md D13, „Einbau“): vorn und hinten, Sternchen mit
 * Nummer, ohne Bedienung. Den Text trägt die Liste daneben; die Figur ist Lesehilfe.
 */
export function KoerperschemaMini({
  verletzungen,
  geschlecht,
}: {
  verletzungen: readonly Verletzung[];
  geschlecht: Person['geschlecht'] | undefined;
}) {
  const { token } = useRollen();
  const figur = figurVon(geschlecht);
  const gueltige = nummeriere(verletzungen).filter((n) => n.verletzung.aufgehoben_at == null);
  return (
    <Flex gap={token.marginXS} data-lfh="koerperschema-mini" style={{ flex: '0 0 auto' }}>
      {ANSICHTEN.map((ansicht) => (
        <KoerperFigur
          key={ansicht}
          ansicht={ansicht}
          figur={figur}
          massstab={MINI_MASSSTAB}
          modus="mini"
          sterne={gueltige.filter((n) => n.verletzung.ansicht === ansicht)}
        />
      ))}
    </Flex>
  );
}
