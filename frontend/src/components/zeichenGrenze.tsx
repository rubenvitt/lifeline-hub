/**
 * Zeichengrenze eines Freitextfelds wie beim Server (LFH-937, design.md D8 der Change
 * `lfh-937-eingabegrenzen`).
 *
 * Der Server zählt Unicode-Skalarwerte nach dem Trimmen; `[...s].length` zählt dasselbe (ein
 * Emoji ist ein Zeichen, `s.length` zählte zwei). `zeichenGrenze(max)` liefert die
 * `count`-Props für antds `Input`/`Input.TextArea`: erst ab 80 % erscheint „n / max“ in Mono mit
 * `tabular-nums` — darunter bleibt die Maske unverändert (die ETB-Erfassungsleiste hat ein
 * Höhenbudget).
 *
 * **Es wird nie gekürzt**, auch nicht beim Tippen oder Einfügen: `@rc-component/input` ruft einen
 * `exceedFormatter` bei JEDEM `onChange` über der Grenze (`hooks/useCountExceed.js`), ein
 * vorbelegter Text verlöre so beim ersten gelöschten Zeichen sein Ende. Über der Grenze nennt der
 * Zähler die Überlänge in `alarmText` und als Wort („zu lang“), und das Senden sperrt: im Formular
 * über {@link zeichenRegel} (Pflicht an jedem Feld mit `zeichenGrenze`), außerhalb über
 * {@link istZuLang} beim Aufrufer. Grenzwerte: `api/eingabegrenzen.ts`.
 */
import type { FormRule, InputProps } from 'antd';
import { schriftStil, useRollen } from './instrument/rollenwerte';

type ZaehlerKonfig = NonNullable<InputProps['count']>;

/** Ab diesem Anteil der Grenze zeigt das Feld den Zähler. */
export const ZAEHLER_AB_ANTEIL = 0.8;

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** Zeichen wie beim Server: Unicode-Skalarwerte, nicht UTF-16-Einheiten. */
export function zeichenZahl(s: string): number {
  return [...s].length;
}

/** Ob der Server den Wert ablehnte: gemessen nach dem Trimmen, genau `max` ist erlaubt. */
export function istZuLang(s: string | null | undefined, max: number): boolean {
  return s != null && zeichenZahl(s.trim()) > max;
}

/** Eine Grenze deutsch gruppiert („8.000“), wie die übrigen Zahlen der Oberfläche. */
export function grenzeText(max: number): string {
  return ZAHL.format(max);
}

/** „n / max“ ab 80 % der Grenze, darüber mit „· zu lang“; darunter `null`. */
export function zaehlerText(anzahl: number, max: number): string | null {
  if (anzahl < max * ZAEHLER_AB_ANTEIL) return null;
  const text = `${ZAHL.format(anzahl)} / ${ZAHL.format(max)}`;
  return anzahl > max ? `${text} · zu lang` : text;
}

/**
 * Der Zähler als Element: Mono-Meta mit `tabular-nums` (`frontend/AGENTS.md`, `schriftskala`).
 * Eine Überlänge steht in `alarmText`, nicht in antds Füllfarbe `colorError` (LFH-874), und
 * zusätzlich als Wort im Text.
 */
export function Zeichenzaehler({ wert, max }: { wert: string; max: number }) {
  const { rollen } = useRollen();
  const anzahl = zeichenZahl(wert);
  const text = zaehlerText(anzahl, max);
  if (text == null) return null;
  return (
    <span
      data-lfh="zeichen-zaehler"
      style={{ ...schriftStil('meta'), ...(anzahl > max ? { color: rollen.alarmText } : {}) }}
    >
      {text}
    </span>
  );
}

const zaehlen = (s: string) => zeichenZahl(s);

/** Je Grenze und Form genau eine Konfiguration: antd merkt sie sich per Identität (`useMemo`). */
const konfigurationen = new Map<string, ZaehlerKonfig>();

/**
 * `count`-Props für antds `Input`/`Input.TextArea`. Mit `zaehler: false` zählt das Feld nicht
 * selbst — der Aufrufer zeigt {@link Zeichenzaehler} an anderer Stelle (ETB-Hinweiszeile); die
 * Fehlerfarbe der Überlänge (`ant-input-out-of-range`) bleibt.
 */
export function zeichenGrenze(
  max: number,
  { zaehler = true }: { zaehler?: boolean } = {},
): ZaehlerKonfig {
  const schluessel = `${max}:${zaehler}`;
  const vorhanden = konfigurationen.get(schluessel);
  if (vorhanden) return vorhanden;
  const konfig: ZaehlerKonfig = {
    max,
    strategy: zaehlen,
  };
  if (zaehler) {
    konfig.show = ({ value }) => <Zeichenzaehler wert={value} max={max} />;
  }
  konfigurationen.set(schluessel, konfig);
  return konfig;
}

/**
 * Formularregel für einen Wert, der von außen über der Grenze stehen kann (vorbelegter Text aus
 * Meldung, Chat oder ETB): Absenden scheitert, bis gekürzt ist, mit dem Wortlaut des Servers
 * („{Feld} darf höchstens {max} Zeichen lang sein“).
 */
export function zeichenRegel(max: number, feld: string) {
  return {
    validator: (_: unknown, wert: unknown) =>
      typeof wert === 'string' && istZuLang(wert, max)
        ? Promise.reject(new Error(`${feld} darf höchstens ${grenzeText(max)} Zeichen lang sein`))
        : Promise.resolve(),
  } satisfies FormRule;
}
