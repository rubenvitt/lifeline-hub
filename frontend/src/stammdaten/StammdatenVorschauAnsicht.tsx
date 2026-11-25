import { Alert, Flex, Typography } from 'antd';
import type {
  StammdatenArtZaehlung,
  StammdatenDateiArt,
  StammdatenDateiMeldung,
  StammdatenEntscheidungen,
  StammdatenQualiWahl,
  StammdatenQualiZeile,
  StammdatenTrefferGrund,
  StammdatenVorschau,
  StammdatenZaehlung,
  StammdatenZeile,
  StammdatenZeilenWahl,
} from '../api/types';
import { Select } from '../components/Select';
import { FELD_KLASSE, Stapel, useRollen } from '../components/instrument';
import { Marke } from '../components/instrument/Marke';

/**
 * Vorschau einer Stammdaten-Übernahme (LLH-1633): Zählung, Fehler, Zeilen mit offener
 * Entscheidung zuerst, dann die Zeilen je Art, Qualifikationen unbekannter Quelle als eigener
 * Block. Die Ansicht kennt keine Datei: sie bekommt die Vorschau des Servers und die bisherigen
 * Entscheidungen, jede Wahl geht über `onEntscheidungen` an den Aufrufer, der die Vorschau neu
 * abfragt. Eine zweite Quelle (ein Stand statt einer Datei) kann sie so mitbenutzen.
 */

const ART_NAME: Record<StammdatenDateiArt, { eins: string; viele: string; titel: string }> = {
  fahrzeug: { eins: 'Fahrzeug', viele: 'Fahrzeuge', titel: 'Fahrzeuge' },
  personal: { eins: 'Person', viele: 'Personen', titel: 'Personal' },
  qualifikation: { eins: 'Qualifikation', viele: 'Qualifikationen', titel: 'Qualifikationen' },
};

const GRUND: Record<StammdatenTrefferGrund, string> = {
  kennung: 'Kennung',
  opta: 'OPTA',
  issi: 'ISSI',
  funkrufname: 'Funkrufname',
  personalnummer: 'Personalnummer',
  name: 'Name',
  bezeichnung: 'Bezeichnung',
};

const ARTEN: StammdatenDateiArt[] = ['fahrzeug', 'personal'];
const ZAEHL_SCHLUESSEL: Record<StammdatenDateiArt, keyof StammdatenZaehlung> = {
  fahrzeug: 'fahrzeuge',
  personal: 'personal',
  qualifikation: 'qualifikationen',
};

function zahl(n: number): string {
  return n.toLocaleString('de-DE');
}

function mehrzahl(n: number, eins: string, viele: string): string {
  return `${zahl(n)} ${n === 1 ? eins : viele}`;
}

/** Was das Übernehmen in einer Art ändert: neu angelegt, ergänzt oder geändert. */
export function artAenderungen(z: StammdatenArtZaehlung): number {
  return z.neu + z.ergaenzt + z.geaendert;
}

/** Die Zählung als kurze Marken je Art; ohne Änderung genau eine. */
export function zaehlungMarken(z: StammdatenZaehlung): string[] {
  const marken: string[] = [];
  for (const art of ['fahrzeug', 'personal', 'qualifikation'] as const) {
    const a = z[ZAEHL_SCHLUESSEL[art]];
    const name = ART_NAME[art];
    const teile: [number, string][] = [
      [a.neu, 'neu'],
      [a.ergaenzt, 'ergänzt'],
      [a.geaendert, 'geändert'],
      [a.unveraendert, 'unverändert'],
      [a.ausgelassen, 'ausgelassen'],
    ];
    for (const [n, zustand] of teile) {
      if (n > 0) marken.push(`${mehrzahl(n, name.eins, name.viele)} ${zustand}`);
    }
  }
  const aenderungen = [z.fahrzeuge, z.personal, z.qualifikationen].reduce(
    (s, a) => s + artAenderungen(a),
    0,
  );
  if (aenderungen === 0) marken.unshift('Keine Änderungen');
  return marken;
}

export function artZaehlungen(z: StammdatenZaehlung): StammdatenArtZaehlung[] {
  return [z.fahrzeuge, z.personal, z.qualifikationen];
}

// ---------------------------------------------------------------------------------------------
// Entscheidungen lesen und schreiben

const VORSCHLAG = 'vorschlag';

function zeilenWert(w: StammdatenZeilenWahl): string {
  return w.art === 'kandidat' ? `kandidat:${w.id}` : w.art;
}

function zeilenWahl(wert: string): StammdatenZeilenWahl | null {
  if (wert === VORSCHLAG) return null;
  if (wert.startsWith('kandidat:')) return { art: 'kandidat', id: Number(wert.slice(9)) };
  if (wert === 'neu' || wert === 'auslassen' || wert === 'datei_uebernehmen') return { art: wert };
  return null;
}

function qualiWert(w: StammdatenQualiWahl): string {
  return w.art === 'zuordnen' ? `zuordnen:${w.qualifikation_id}` : w.art;
}

function qualiWahl(wert: string): StammdatenQualiWahl | null {
  if (wert === VORSCHLAG) return null;
  if (wert.startsWith('zuordnen:')) {
    return { art: 'zuordnen', qualifikation_id: Number(wert.slice(9)) };
  }
  if (wert === 'neu' || wert === 'auslassen') return { art: wert };
  return null;
}

function gewaehlt(e: StammdatenEntscheidungen, z: StammdatenZeile): StammdatenZeilenWahl | null {
  const eintrag = (e.zeilen ?? []).find((x) => x.art === z.art && x.zeile === z.zeile);
  return eintrag?.wahl ?? z.wahl ?? null;
}

function qualiGewaehlt(
  e: StammdatenEntscheidungen,
  q: StammdatenQualiZeile,
): StammdatenQualiWahl | null {
  const eintrag = (e.qualifikationen ?? []).find((x) => x.text === q.text);
  return eintrag?.wahl ?? q.wahl ?? null;
}

/** Offen: mehrdeutig und noch ohne Wahl. Sperrt das Übernehmen. */
function zeileOffen(e: StammdatenEntscheidungen, z: StammdatenZeile): boolean {
  return z.ergebnis === 'mehrdeutig' && gewaehlt(e, z) == null;
}

function qualiOffen(e: StammdatenEntscheidungen, q: StammdatenQualiZeile): boolean {
  return q.ergebnis === 'mehrdeutig' && qualiGewaehlt(e, q) == null;
}

function mitZeilenWahl(
  e: StammdatenEntscheidungen,
  z: StammdatenZeile,
  wahl: StammdatenZeilenWahl | null,
): StammdatenEntscheidungen {
  const rest = (e.zeilen ?? []).filter((x) => !(x.art === z.art && x.zeile === z.zeile));
  return {
    ...e,
    zeilen: wahl ? [...rest, { art: z.art, zeile: z.zeile, wahl }] : rest,
  };
}

function mitQualiWahl(
  e: StammdatenEntscheidungen,
  q: StammdatenQualiZeile,
  wahl: StammdatenQualiWahl | null,
): StammdatenEntscheidungen {
  const rest = (e.qualifikationen ?? []).filter((x) => x.text !== q.text);
  return {
    ...e,
    qualifikationen: wahl ? [...rest, { text: q.text, wahl }] : rest,
  };
}

// ---------------------------------------------------------------------------------------------
// Bausteine

function zeilenOptionen(z: StammdatenZeile) {
  const abweichend = z.aenderungen.some((a) => a.art === 'weicht_ab');
  const auslassen = { value: 'auslassen', label: 'Auslassen' };
  switch (z.ergebnis) {
    case 'neu':
      return [{ value: VORSCHLAG, label: 'Neu anlegen' }, auslassen];
    case 'gefunden':
      return [
        { value: VORSCHLAG, label: 'Lücken füllen, Bestand behalten' },
        ...(abweichend ? [{ value: 'datei_uebernehmen', label: 'Datei übernehmen' }] : []),
        { value: 'neu', label: 'Neu anlegen' },
        auslassen,
      ];
    case 'mehrdeutig':
      return [
        ...z.kandidaten.map((k) => ({ value: `kandidat:${k.id}`, label: k.anzeige })),
        { value: 'neu', label: 'Neu anlegen' },
        auslassen,
      ];
    case 'fehler':
      return [{ value: VORSCHLAG, label: 'Nicht übernehmbar' }, auslassen];
    default:
      return null;
  }
}

function qualiOptionen(q: StammdatenQualiZeile) {
  const auslassen = { value: 'auslassen', label: 'Auslassen' };
  const zuordnen = q.kandidaten.map((k) => ({
    value: `zuordnen:${k.id}`,
    label: `Zuordnen zu ${k.anzeige}`,
  }));
  switch (q.ergebnis) {
    case 'neu':
      return [{ value: VORSCHLAG, label: 'Neu anlegen' }, ...zuordnen, auslassen];
    case 'mehrdeutig':
      return [...zuordnen, { value: 'neu', label: 'Neu anlegen' }, auslassen];
    case 'gefunden':
    case 'ausser_dienst':
      return [{ value: VORSCHLAG, label: 'Mit Bestand verknüpfen' }, ...zuordnen, auslassen];
    default:
      return [{ value: VORSCHLAG, label: 'Nicht übernehmbar' }, auslassen];
  }
}

function Hinweise({ hinweise }: { hinweise: string[] }) {
  if (hinweise.length === 0) return null;
  return (
    <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
      {hinweise.map((h, i) => (
        <li key={i}>
          <Typography.Text type="secondary">{h}</Typography.Text>
        </li>
      ))}
    </ul>
  );
}

function ZeilenKopf({
  titel,
  nebenan,
  marken,
}: {
  titel: string;
  nebenan: string;
  marken: string[];
}) {
  const { token } = useRollen();
  return (
    <span style={{ flex: '1 1 12rem', minWidth: 0 }}>
      <Typography.Text strong>{titel}</Typography.Text>
      <Typography.Text type="secondary"> · {nebenan}</Typography.Text>
      {marken.map((m) => (
        <Marke key={m} style={{ marginInlineStart: token.marginXS }}>
          {m}
        </Marke>
      ))}
    </span>
  );
}

function DateiZeile({
  zeile,
  e,
  gesperrt,
  onWahl,
}: {
  zeile: StammdatenZeile;
  e: StammdatenEntscheidungen;
  gesperrt: boolean;
  onWahl: (w: StammdatenZeilenWahl | null) => void;
}) {
  const { token } = useRollen();
  const optionen = zeilenOptionen(zeile);
  const wahl = gewaehlt(e, zeile);
  const offen = zeileOffen(e, zeile);
  const marken = [
    zeile.ergebnis === 'neu'
      ? 'Neu'
      : zeile.ergebnis === 'unveraendert'
        ? 'Unverändert'
        : zeile.ergebnis === 'ausser_dienst'
          ? 'Außer Dienst'
          : zeile.ergebnis === 'fehler'
            ? 'Fehler'
            : zeile.ergebnis === 'mehrdeutig'
              ? offen
                ? 'Offen'
                : 'Mehrdeutig'
              : 'Gefunden',
    ...(zeile.grund ? [`über ${GRUND[zeile.grund]}`] : []),
  ];
  return (
    <div data-lfh="stammdaten-zeile" style={{ paddingBlock: token.paddingXXS }}>
      <Flex gap={token.marginSM} align="center" wrap>
        <ZeilenKopf titel={zeile.anzeige} nebenan={`Zeile ${zeile.zeile}`} marken={marken} />
        {optionen != null && (
          <div className={FELD_KLASSE} style={{ flex: '1 1 14rem', minWidth: 0 }}>
            <Select
              aria-label={`Wahl für ${zeile.anzeige}`}
              placeholder="Bitte wählen"
              value={wahl ? zeilenWert(wahl) : offen ? undefined : VORSCHLAG}
              onChange={(w: string) => onWahl(zeilenWahl(w))}
              disabled={gesperrt}
              options={optionen}
            />
          </div>
        )}
      </Flex>
      {zeile.aenderungen.length > 0 && (
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }} data-lfh="stammdaten-aenderungen">
          {zeile.aenderungen.map((a) => (
            <li key={a.feld}>
              <Typography.Text type="secondary">
                {a.feld}: {a.alt != null && a.alt !== '' ? `${a.alt} → ${a.neu}` : a.neu}
                {' · '}
                {a.art === 'fuellt' ? 'füllt Lücke' : 'weicht ab'}
                {a.uebernommen
                  ? ', wird übernommen'
                  : a.art === 'weicht_ab'
                    ? a.erkennungsfeld
                      ? ', nur Hinweis'
                      : ', Bestand bleibt'
                    : ''}
              </Typography.Text>
            </li>
          ))}
        </ul>
      )}
      <Hinweise hinweise={zeile.hinweise} />
    </div>
  );
}

function QualiBlockZeile({
  quali,
  e,
  gesperrt,
  onWahl,
}: {
  quali: StammdatenQualiZeile;
  e: StammdatenEntscheidungen;
  gesperrt: boolean;
  onWahl: (w: StammdatenQualiWahl | null) => void;
}) {
  const { token } = useRollen();
  const wahl = qualiGewaehlt(e, quali);
  const offen = qualiOffen(e, quali);
  return (
    <div data-lfh="stammdaten-quali" style={{ paddingBlock: token.paddingXXS }}>
      <Flex gap={token.marginSM} align="center" wrap>
        <ZeilenKopf
          titel={quali.text}
          nebenan={
            quali.zeilen.length > 0 ? `Zeile ${quali.zeilen.join(', ')}` : 'aus dem Personal'
          }
          marken={[offen ? 'Offen' : quali.ergebnis === 'neu' ? 'Unbekannt' : 'Gefunden']}
        />
        <div className={FELD_KLASSE} style={{ flex: '1 1 14rem', minWidth: 0 }}>
          <Select
            aria-label={`Wahl für Qualifikation ${quali.text}`}
            placeholder="Bitte wählen"
            value={wahl ? qualiWert(wahl) : offen ? undefined : VORSCHLAG}
            onChange={(w: string) => onWahl(qualiWahl(w))}
            disabled={gesperrt}
            options={qualiOptionen(quali)}
          />
        </div>
      </Flex>
      <Hinweise hinweise={quali.hinweise} />
    </div>
  );
}

function Meldungen({
  meldungen,
  stufe,
}: {
  meldungen: readonly StammdatenDateiMeldung[];
  stufe: 'fehler' | 'hinweis';
}) {
  const liste = meldungen.filter((m) => m.stufe === stufe);
  if (liste.length === 0) return null;
  return (
    <Alert
      type={stufe === 'fehler' ? 'error' : 'warning'}
      showIcon
      data-lfh={`einlesen-${stufe}`}
      title={
        stufe === 'fehler'
          ? mehrzahl(liste.length, 'Fehler', 'Fehler')
          : mehrzahl(liste.length, 'Hinweis', 'Hinweise')
      }
      description={
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {liste.map((m, i) => (
            <li key={i}>{m.zeile != null ? `Zeile ${m.zeile}: ${m.text}` : m.text}</li>
          ))}
        </ul>
      }
    />
  );
}

/** Spalten, die der Vertrag nicht kennt; sie werden nie übernommen. */
export function NichtUebernommen({ spalten }: { spalten: readonly string[] }) {
  if (spalten.length === 0) return null;
  return (
    <Alert
      type="info"
      showIcon
      data-lfh="einlesen-nicht-uebernommen"
      title={`Nicht übernommene Spalten: ${spalten.join(', ')}`}
    />
  );
}

/** Anzahl der offenen Entscheidungen (mehrdeutig ohne Wahl) unter den bisherigen Wahlen. */
export function offeneEntscheidungen(v: StammdatenVorschau, e: StammdatenEntscheidungen): number {
  return (
    v.zeilen.filter((z) => zeileOffen(e, z)).length +
    v.qualifikationen.filter((q) => qualiOffen(e, q)).length
  );
}

/** Qualifikationen, über die der Anwender entscheiden kann: unbekannte, mehrdeutige, inaktive. */
function qualiZuEntscheiden(q: StammdatenQualiZeile): boolean {
  return q.ergebnis !== 'unveraendert' && q.ergebnis !== 'gefunden';
}

interface StammdatenVorschauAnsichtProps {
  vorschau: StammdatenVorschau;
  entscheidungen: StammdatenEntscheidungen;
  onEntscheidungen: (neu: StammdatenEntscheidungen) => void;
  /** Während einer Abfrage oder des Übernehmens. */
  gesperrt?: boolean;
}

/** Die Vorschau samt Wahl je Zeile und Qualifikation. */
export function StammdatenVorschauAnsicht({
  vorschau,
  entscheidungen,
  onEntscheidungen,
  gesperrt = false,
}: StammdatenVorschauAnsichtProps) {
  const e = entscheidungen;
  const offen = vorschau.zeilen.filter((z) => zeileOffen(e, z));
  const uebrige = vorschau.zeilen.filter((z) => !zeileOffen(e, z));
  const qualis = vorschau.qualifikationen.filter(qualiZuEntscheiden);
  // Offene zuerst, sonst die Reihenfolge der Datei.
  const qualiSortiert = [...qualis].sort(
    (a, b) => Number(qualiOffen(e, b)) - Number(qualiOffen(e, a)),
  );
  const zeile = (z: StammdatenZeile) => (
    <DateiZeile
      key={`${z.art}-${z.zeile}`}
      zeile={z}
      e={e}
      gesperrt={gesperrt}
      onWahl={(w) => onEntscheidungen(mitZeilenWahl(e, z, w))}
    />
  );
  return (
    <div data-lfh="einlesen-vorschau">
      <Stapel abstand="md">
        <div data-lfh="einlesen-zaehlung">
          <Stapel richtung="zeile" umbruch abstand="xs">
            {zaehlungMarken(vorschau.zaehlung).map((m) => (
              <Marke key={m}>{m}</Marke>
            ))}
          </Stapel>
        </div>
        <Meldungen meldungen={vorschau.meldungen} stufe="fehler" />
        <NichtUebernommen spalten={vorschau.nicht_uebernommen} />
        {offen.length > 0 && (
          <section aria-label="Braucht Entscheidung" data-lfh="stammdaten-offen">
            <Typography.Title level={5}>Braucht Entscheidung</Typography.Title>
            {offen.map(zeile)}
          </section>
        )}
        {ARTEN.map((art) => {
          const zeilen = uebrige.filter((z) => z.art === art);
          if (zeilen.length === 0) return null;
          return (
            <section key={art} aria-label={ART_NAME[art].titel}>
              <Typography.Title level={5}>{ART_NAME[art].titel}</Typography.Title>
              {zeilen.map(zeile)}
            </section>
          );
        })}
        {qualiSortiert.length > 0 && (
          <section aria-label="Qualifikationen" data-lfh="stammdaten-qualifikationen">
            <Typography.Title level={5}>Qualifikationen</Typography.Title>
            {qualiSortiert.map((q) => (
              <QualiBlockZeile
                key={q.text}
                quali={q}
                e={e}
                gesperrt={gesperrt}
                onWahl={(w) => onEntscheidungen(mitQualiWahl(e, q, w))}
              />
            ))}
          </section>
        )}
        <Meldungen meldungen={vorschau.meldungen} stufe="hinweis" />
      </Stapel>
    </div>
  );
}
