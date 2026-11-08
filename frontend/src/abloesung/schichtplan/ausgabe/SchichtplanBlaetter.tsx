import { theme } from 'antd';
import { useMemo, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { useAnzeigeKonventionen } from '../../../anzeige/AnzeigeKonventionenContext';
import { datum, inZone, uhrzeit, zeitpunkt } from '../../../anzeige/zeitDarstellung';
import Druckkopf from '../../../components/druck/Druckkopf';
import DruckTabelle, { type DruckSpalte } from '../../../druck/DruckTabelle';
import { formatDauer } from '../../dauer';
import {
  aushaenge,
  besetzungText,
  mehrereTage,
  sollText,
  zettel,
  type AusgabePerson,
  type AusgabePlan,
  type AusgabeSchicht,
  type AushangZeile,
  type ZettelZeile,
} from './ausgabePlan';

/** Je Posten (Aushang) oder je Person (Zettel). */
export type BlattSicht = 'posten' | 'person';

interface Props {
  plan: AusgabePlan;
  sicht: BlattSicht;
  /** Schlüssel eines Postens bzw. einer Person; `null` = alle Blätter. */
  auswahl: string | null;
  /** Für den Druckkopf: Einsatz (bzw. später die Planung). */
  einsatz: { bezeichnung: string; einsatznummer_intern?: string | null };
  /** Bezeichnungen der Qualifikationen im Katalog der Organisation. */
  qualiNamen: ReadonlyMap<number, string>;
  /** Wann der Plan geladen wurde (Wire oder ISO). */
  geladenAt: string;
}

/**
 * Die Druckblätter des Schichtplans (LLH-1557, design D3): ein Aushang je Posten oder ein Zettel
 * je Person, jedes Blatt ein Kapitel der Druckwurzel mit eigenem Druckkopf, damit es einzeln
 * hängen kann. `druck/druck.css` beginnt jedes weitere Kapitel auf neuer Seite und hält Zeilen
 * zusammen. Das Blatt rechnet nichts nach: Reihenfolge, Stunden und offene Plätze kommen aus dem
 * Ausgabeplan.
 */
export default function SchichtplanBlaetter({
  plan,
  sicht,
  auswahl,
  einsatz,
  qualiNamen,
  geladenAt,
}: Props) {
  const { token } = theme.useToken();
  const { konventionen } = useAnzeigeKonventionen();
  const mitTag = useMemo(
    () =>
      mehrereTage(plan, (ms) =>
        inZone(dayjs(ms).utc().format('YYYY-MM-DD HH:mm:ss'), konventionen).format('YYYY-MM-DD'),
      ),
    [plan, konventionen],
  );
  const stand = zeitpunkt(geladenAt, konventionen);
  const tag = (s: AusgabeSchicht) => datum(dayjs(s.vonMs), konventionen);
  const zeit = (s: AusgabeSchicht) =>
    `${uhrzeit(dayjs(s.vonMs), konventionen)}–${uhrzeit(dayjs(s.bisMs), konventionen)}`;
  const zeilenweise = (eintraege: readonly ReactNode[]) =>
    eintraege.map((e, i) => <div key={i}>{e}</div>);
  const qualis = (p: AusgabePerson) =>
    p.qualifikationen
      .map((q) => qualiNamen.get(q))
      .filter(Boolean)
      .join(', ') || '–';
  const kapitel = (schluessel: string, inhalt: ReactNode) => (
    <section
      key={schluessel}
      data-lfh="druck-kapitel"
      data-blatt={schluessel}
      style={{ marginBlockEnd: token.marginXL }}
    >
      {inhalt}
    </section>
  );

  if (sicht === 'posten') {
    const blaetter = aushaenge(plan).filter((a) => !auswahl || a.posten.schluessel === auswahl);
    return (
      <>
        {blaetter.map((a) => {
          const soll = a.soll ? sollText(a.soll.anzahl, a.soll.quali) : null;
          const spalten: DruckSpalte<AushangZeile>[] = [
            ...(mitTag
              ? [{ titel: 'Tag', wert: (z: AushangZeile) => tag(z.schicht), mono: true }]
              : []),
            { titel: 'Zeit', wert: (z) => zeit(z.schicht), mono: true },
            ...(a.soll == null
              ? [
                  {
                    titel: 'Soll',
                    wert: (z: AushangZeile) =>
                      sollText(z.schicht.sollAnzahl, z.schicht.qualiSoll)?.replace(/^Soll /, '') ??
                      '–',
                  },
                ]
              : []),
            {
              titel: 'Eingeteilt',
              wert: (z) =>
                zeilenweise([
                  ...(plan.personen == null
                    ? [besetzungText(z.schicht)]
                    : z.personen.map((p) =>
                        p.organisation ? `${p.name} (${p.organisation})` : p.name,
                      )),
                  ...(z.schicht.offen > 0
                    ? [<strong key="offen">{`${z.schicht.offen} offen`}</strong>]
                    : []),
                ]),
            },
            ...(plan.personen == null
              ? []
              : [
                  {
                    titel: 'Qualifikation',
                    wert: (z: AushangZeile) => zeilenweise(z.personen.map(qualis)),
                  },
                ]),
          ];
          return kapitel(
            a.posten.schluessel,
            <>
              <Druckkopf
                dokumentart="Aushang"
                titel={a.posten.titel}
                einsatz={einsatz}
                sichtbarkeit="immer"
                ebene={2}
                zeilen={[
                  ...(a.posten.abschnitt
                    ? [{ etikett: 'Abschnitt', wert: a.posten.abschnitt }]
                    : []),
                  ...(soll ? [{ etikett: 'Soll', wert: soll.replace(/^Soll /, '') }] : []),
                  { etikett: 'Stand', wert: stand },
                ]}
              />
              <DruckTabelle
                kennung="schichtplan-aushang"
                spalten={spalten}
                zeilen={a.zeilen}
                schluessel={(z) => z.schicht.id}
              />
            </>,
          );
        })}
      </>
    );
  }

  const blaetter = zettel(plan).filter((z) => !auswahl || z.person.schluessel === auswahl);
  return (
    <>
      {blaetter.map((z) => {
        const spalten: DruckSpalte<ZettelZeile>[] = [
          ...(mitTag
            ? [{ titel: 'Tag', wert: (r: ZettelZeile) => tag(r.schicht), mono: true }]
            : []),
          { titel: 'Zeit', wert: (r) => zeit(r.schicht), mono: true },
          {
            titel: 'Wo',
            wert: (r) =>
              r.posten.abschnitt ? `${r.posten.titel} · ${r.posten.abschnitt}` : r.posten.titel,
          },
          {
            titel: 'Mit',
            wert: (r) => (r.mit.length > 0 ? r.mit.map((p) => p.name).join(', ') : '–'),
          },
        ];
        const umfang = `${z.schichten === 1 ? '1 Schicht' : `${z.schichten} Schichten`}, ${formatDauer(z.minuten)}`;
        return kapitel(
          z.person.schluessel,
          <>
            <Druckkopf
              dokumentart="Schichtzettel"
              titel={z.person.name}
              einsatz={einsatz}
              sichtbarkeit="immer"
              ebene={2}
              zeilen={[
                { etikett: 'Umfang', wert: umfang },
                ...(z.person.organisation
                  ? [{ etikett: 'Organisation', wert: z.person.organisation }]
                  : []),
                ...(z.person.telefon ? [{ etikett: 'Telefon', wert: z.person.telefon }] : []),
                { etikett: 'Stand', wert: stand },
              ]}
            />
            <DruckTabelle
              kennung="schichtplan-zettel"
              spalten={spalten}
              zeilen={z.zeilen}
              schluessel={(r) => r.schicht.id}
            />
          </>,
        );
      })}
    </>
  );
}
