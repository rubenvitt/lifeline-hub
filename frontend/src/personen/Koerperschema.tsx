import { Button, Flex, Form, Typography } from 'antd';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { VerletzungEingabe } from '../api/einsatzPerson';
import type {
  Person,
  Verletzung,
  VerletzungAnsicht,
  VerletzungArt,
  VerletzungSchwere,
} from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import BestaetigtVonFeld, { BESTAETIGT_FELD } from '../geraet/BestaetigtVonFeld';
import FlaechenWahl from './FlaechenWahl';
import KoerperFigur, { type KoerperZiel } from './koerperschema/KoerperFigur';
import { figurMassstab, normiere, sternLage } from './koerperschema/geometrie';
import {
  figurVon,
  nummeriere,
  regionName,
  type NummerierteVerletzung,
} from './koerperschema/koerperschemaKern';
import { VERLETZUNG_ART_REIHE, VERLETZUNG_ART_WORT, VERLETZUNG_SCHWERE_WORT } from './personMeta';

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
 * Wahl offen.
 *
 * Die Mutationen hält der Aufrufer (Patientenkopf: Wechselsperre, ein Schreibweg je Handlung);
 * am UHS-Gerät nennt `BestaetigtVonFeld` die bestätigende Person.
 *
 * LESEN UND DRUCK zeigen Figur und Liste ohne Bedienung; der Druck zeichnet ohne Fläche in
 * `currentColor` (schwarz auf weiß). Ab `md` stehen vorn und hinten nebeneinander, darunter wählt
 * eine Segmentleiste die Ansicht.
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
  { wert: OHNE, label: 'ohne' },
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
  const [ansichtSchmal, setAnsichtSchmal] = useState<VerletzungAnsicht>('vorn');
  const [auswahl, setAuswahl] = useState<Auswahl>(null);
  const [schwere, setSchwere] = useState<VerletzungSchwere | typeof OHNE>(OHNE);
  const [form] = Form.useForm<{ [BESTAETIGT_FELD]?: number }>();

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
  const sichtbar = abMd || modus === 'druck' ? ANSICHTEN : [ansichtSchmal];

  function waehleRegion(ziel: KoerperZiel) {
    if (laeuft) return;
    setAuswahl({ art: 'region', ziel });
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
      },
      // Die Ablehnung zeigt das Schema aus `markierung.error`; die Wahl bleibt offen.
      () => {},
    );
  }

  function aufheben(id: number) {
    if (!aufhebung || laeuft || aufhebenGesperrt) return;
    aufhebung.mutateAsync(id).then(
      () => setAuswahl(null),
      () => {},
    );
  }

  const gewaehlterStern = auswahl?.art === 'stern' ? auswahl.id : null;
  const stern =
    gewaehlterStern != null ? gueltige.find((n) => n.verletzung.id === gewaehlterStern) : undefined;

  return (
    <section
      aria-label="Körperschema"
      data-lfh="koerperschema"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
    >
      {!abMd && modus !== 'druck' && (
        <Segmentleiste<VerletzungAnsicht>
          rolle="tablist"
          beschriftung="Ansicht"
          optionen={ANSICHTEN.map((a) => ({ wert: a, label: a }))}
          wert={ansichtSchmal}
          onWechsel={setAnsichtSchmal}
        />
      )}
      {modus === 'markieren' && gesperrt && (
        <div role="status" style={{ color: rollen.text2 }}>
          {gesperrt}
        </div>
      )}
      <Flex gap={token.marginLG} wrap align="flex-start">
        <Flex gap={token.marginSM} wrap>
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
        </Flex>

        <Flex vertical gap={token.marginSM} style={{ flex: '1 1 260px', minWidth: 0 }}>
          {markieren && auswahl?.art === 'region' && (
            <Form form={form} layout="vertical" component="div">
              <div
                role="group"
                aria-label={`Verletzung an ${regionName(auswahl.ziel.ansicht, auswahl.ziel.zone.region)}`}
                data-lfh="verletzung-wahl"
                style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
              >
                <Typography.Text strong>
                  {regionName(auswahl.ziel.ansicht, auswahl.ziel.zone.region)}
                </Typography.Text>
                <Segmentleiste<VerletzungSchwere | typeof OHNE>
                  beschriftung="Schwere (optional)"
                  optionen={SCHWERE_OPTIONEN}
                  wert={schwere}
                  onWechsel={setSchwere}
                />
                <FlaechenWahl<VerletzungArt>
                  aria-label="Art der Verletzung"
                  optionen={ART_OPTIONEN}
                  value={null}
                  disabled={laeuft}
                  onChange={speichern}
                />
                <BestaetigtVonFeld einsatzId={einsatzId} />
                <div>
                  <Button disabled={laeuft} onClick={() => setAuswahl(null)}>
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
                <span style={monoStil(13)}>{stern.nummer}</span> {verletzungText(stern.verletzung)}
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
                  onClick={() => aufheben(stern.verletzung.id)}
                >
                  Aufheben
                </Button>
                <Button disabled={laeuft} onClick={() => setAuswahl(null)}>
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
        </Flex>
      </Flex>
    </section>
  );
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
