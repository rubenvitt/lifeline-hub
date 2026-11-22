import { Button, Space } from 'antd';
import { createContext, useContext, type ReactNode } from 'react';
import { dichten, type Dichte } from '../theme/tokens';
import { MenueAusloeser, type MenueEintrag } from './MenueAusloeser';
import { menueSpaltenBreite } from './menueSpalte';
import { textBreite } from './textBreite';

/**
 * Die Aktionsspalte einer Tabelle (LLH-1789, Change `lsug0joq-tabellen-touch`, design.md D1):
 * EIN Bauer für die Spalte mit Primäraktion und ⋮, aus denselben Paaren wie Karte und
 * Kontextmenü (`PrimaerAktion`/`WeitereAktionen` der `Datensicht`). Die Spalte trägt `amEnde`:
 * ab `md` steht sie rechts fixiert, unter `md` reitet ihr Inhalt in der fixierten Kennung mit
 * (`Datensicht`), so liegt die Hauptaktion einer Zeile in keiner Breite hinter dem Querscrollen.
 *
 * Die Breite ist fest je Stufe und Beschriftung, gerechnet statt gemessen: das ⋮ wie
 * {@link menueSpaltenBreite}, dazu der Knopf der Primäraktion (Beschriftung in der Schrift der
 * Stufe, Knopfpolster, Rand) und die Fuge von `Space size="middle"`.
 */

/** Was die Spalte von einer Primäraktion braucht (Teilmenge von `PrimaerAktion`). */
export interface SpaltenAktion<T> {
  etikett: string;
  onKlick: (zeile: T) => void;
  zugaenglicherName?: (zeile: T) => string;
  sichtbar?: (zeile: T) => boolean;
  gesperrt?: (zeile: T) => boolean;
  /**
   * Was an der Stelle des Knopfs steht, wenn er für diese Zeile nicht sichtbar ist (etwa der
   * Kurzgrund „namentlich“ einer Betreuungsstelle, LLH-1612). Fehlt = nichts.
   */
  ersatz?: (zeile: T) => ReactNode;
}

/** Was die Spalte vom ⋮ braucht (wie `WeitereAktionen`). */
export interface SpaltenWeitere<T> {
  eintraege: (zeile: T) => readonly MenueEintrag[];
  zugaenglicherName: (zeile: T) => string;
  onWahl: (key: string, zeile: T) => void;
  laeuft?: (zeile: T) => boolean;
}

/** antds Knopfpolster beidseits (15 px) und Rand (1 px) der Größe `middle`. */
const KNOPF_RAHMEN = 2 * 15 + 2;

export function aktionsSpaltenBreite({
  dichte,
  primaer,
  messen,
}: {
  dichte: Dichte;
  /** Beschriftung der Primäraktion; ohne sie trägt die Spalte nur das ⋮. */
  primaer?: string;
  /** Breite eines Texts in der Schrift der Stufe. */
  messen: (text: string, schriftgroesse: number) => number;
}): number {
  const menue = menueSpaltenBreite(dichte);
  if (primaer == null) return menue;
  const stufe = dichten[dichte];
  const knopf = Math.max(
    stufe.kleineZeilenhoehe,
    messen(primaer, stufe.schriftgroesse) + KNOPF_RAHMEN,
  );
  // Die Fuge von `Space size="middle"`: antd liest sie aus `token.padding`, und das ist
  // `abstand.md` der Stufe (`antdToken`), also 12 / 20 / 24 px (LLH-1961).
  return Math.ceil(menue + knopf + stufe.abstand.md);
}

/**
 * Meldet `AktionsInhalt`, dass er in der fixierten Kennung unter `md` steht (`Datensicht`
 * setzt ihn dort). Ab `md` hat die Reihe ihre eigene, breit genug gerechnete Spalte und bleibt
 * nebeneinander.
 */
export const KennungAktionKontext = createContext(false);

/** Der Inhalt einer Aktionszelle; derselbe in der Spalte und in der Kennung unter `md`. */
export function AktionsInhalt<T>({
  zeile,
  aktion,
  weitere,
}: {
  zeile: T;
  aktion?: SpaltenAktion<T>;
  weitere?: SpaltenWeitere<T>;
}): ReactNode {
  const inKennung = useContext(KennungAktionKontext);
  const sichtbar = aktion != null && (aktion.sichtbar?.(zeile) ?? true);
  const knopf = !aktion ? null : !sichtbar ? (
    (aktion.ersatz?.(zeile) ?? null)
  ) : (
    <Button
      aria-label={aktion.zugaenglicherName?.(zeile)}
      disabled={aktion.gesperrt?.(zeile) ?? false}
      onClick={() => aktion.onKlick(zeile)}
    >
      {aktion.etikett}
    </Button>
  );
  const eintraege = weitere?.eintraege(zeile) ?? [];
  const menue =
    weitere && eintraege.length > 0 ? (
      <MenueAusloeser
        eintraege={eintraege}
        zugaenglicherName={weitere.zugaenglicherName(zeile)}
        onWahl={(key) => weitere.onWahl(key, zeile)}
        laeuft={weitere.laeuft?.(zeile)}
      />
    ) : null;
  if (!knopf && !menue) return null;
  const reihe = (
    <Space size="middle" wrap={inKennung}>
      {knopf}
      {menue}
    </Space>
  );
  if (!inKennung) return reihe;
  // In der Kennung bemisst die Reihe die Spalte nicht mit: `min-content` meldet der Tabelle nur
  // das breiteste Teil, `minWidth: 100%` füllt danach die Zelle. So setzt der Name die Breite, und
  // ⋮ bricht nur um, wenn der Platz fehlt (Betreuungsstellen auf 390 px,
  // `e2e/betreuung-stellen-schmal.spec.ts`). Ohne Knopf und ⋮ kein leerer Kasten: er brächte in
  // der Kennung eine Fuge mit.
  return (
    <div
      data-lfh="datensicht-kennung-aktionsreihe"
      style={{ width: 'min-content', minWidth: '100%' }}
    >
      {reihe}
    </div>
  );
}

/**
 * Die Spalte. Schlüssel `aktionen`, immer sichtbar, nicht im Spaltenschalter, `amEnde` für die
 * Fixierung rechts (ab `md`) bzw. den Umzug in die Kennung (unter `md`).
 */
export function aktionsSpalte<T>({
  aktion,
  weitere,
  dichte,
  schrift,
  titel = 'Aktionen',
}: {
  aktion?: SpaltenAktion<T>;
  weitere?: SpaltenWeitere<T>;
  dichte: Dichte;
  /** Schriftfamilie des Fließtexts (`--lfh-schrift-text`); leer = Vorgabe des Browsers. */
  schrift: string;
  titel?: string;
}) {
  return {
    key: 'aktionen' as const,
    title: titel,
    immerSichtbar: true as const,
    amEnde: true as const,
    width: aktionsSpaltenBreite({
      dichte,
      primaer: aktion?.etikett,
      messen: (text, groesse) => textBreite(text, { schrift, groesse, gewicht: 400 }),
    }),
    render: (_: unknown, zeile: T) => (
      <AktionsInhalt zeile={zeile} aktion={aktion} weitere={weitere} />
    ),
  };
}
