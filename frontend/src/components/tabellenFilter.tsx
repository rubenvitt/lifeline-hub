import { Button, theme } from 'antd';
import type { CSSProperties } from 'react';
import { IconKreuz } from '../icons';
import type { Farbrollen } from '../theme/tokens';

/**
 * Bausteine des gemeinsamen Bedienmusters „Sortieren und Filtern“ der beiden Tabellenträger
 * (LLH-1086, Spec `tabellen-sortieren-filtern`, `frontend/AGENTS.md`, „Tabelle und Dichte“):
 * `Datensicht` baut es, `KatalogTabelle` übernimmt es. Hier wohnt, was beide gleich zeigen:
 * die Leiste der aktiven Filter und die Marke einer gefilterten Kopfzelle. Den Hinweis über der
 * Liste trägt `instrument/Filterhinweis` (LLH-1071), kein zweiter Baustein.
 */

/** Ein gewählter Wert einer Filterspalte, wie er als Chip und im Filterhinweis steht. */
export interface AktiverFilter {
  spalte: string;
  wert: string;
  /** „Ausmaß: Groß“ — Etikett der Spalte, dann der Wert in Worten. */
  text: string;
}

/**
 * Die aktiven Filter in Spaltenfolge, je Wert ein Eintrag. Nur Spalten aus `spalten` zählen (der
 * Aufrufer reicht die GEZEIGTEN: was man nicht sieht, wirkt nicht und steht hier nicht). Ein Wert
 * ohne Text in der Werteliste steht roh da, statt zu verschwinden. Rein und exportiert.
 */
export function aktiveFilter(
  spalten: readonly {
    key: string;
    etikett: string;
    werte: readonly { text: string; value: string }[];
  }[],
  filterWerte: Readonly<Record<string, readonly string[]>>,
): AktiverFilter[] {
  return spalten.flatMap((s) =>
    (filterWerte[s.key] ?? []).map((wert) => ({
      spalte: s.key,
      wert,
      text: `${s.etikett}: ${s.werte.find((w) => w.value === wert)?.text ?? wert}`,
    })),
  );
}

/**
 * Merkmale für den `Filterhinweis`: der Suchbegriff in Anführungszeichen, dann je Spalte die
 * Werte („Ausmaß: Groß, Mittel“). Rein und exportiert.
 */
export function filterMerkmale(suchbegriff: string, filter: readonly AktiverFilter[]): string[] {
  const merkmale: string[] = [];
  const begriff = suchbegriff.trim();
  if (begriff !== '') merkmale.push(`„${begriff}“`);
  const jeSpalte = new Map<string, string[]>();
  for (const f of filter) {
    const [etikett, ...rest] = f.text.split(': ');
    const wert = rest.join(': ');
    const liste = jeSpalte.get(etikett);
    if (liste) liste.push(wert);
    else jeSpalte.set(etikett, [wert]);
  }
  for (const [etikett, werte] of jeSpalte) merkmale.push(`${etikett}: ${werte.join(', ')}`);
  return merkmale;
}

/**
 * Die Marke einer gefilterten Kopfzelle: eine 2-px-Linie in `bedien` an der Unterkante, nach innen
 * gezeichnet (kein Rand, der die Zelle höher machte). Form als zweiter Kanal neben antds gefülltem
 * Trichter; das Wort „gefiltert“ steht im Namen des Auslösers (`KatalogTabelle`, LLH-1227) und in
 * Chip und Filterhinweis. Kein Wort IN der Kopfzelle: es verbreiterte schmale Spalten (LFH-1149).
 * Inline über `onHeaderCell`, weil eigenes CSS gegen antds Kopfregeln die Spezifität verliert.
 * Rein und exportiert, aufgelöste Rolle.
 */
export function kopfGefiltertStil(rollen: Pick<Farbrollen, 'bedien'>): CSSProperties {
  return { boxShadow: `inset 0 -2px 0 ${rollen.bedien}` };
}

/**
 * Leiste der aktiven Filter über der Tabelle (LLH-1086): je Wert ein Knopf „Ausmaß: Groß ×“, ein
 * Klick nimmt genau diesen Wert heraus. Knöpfe statt antds schließbarer Marke: deren Kreuz misst
 * 12 px und hält keine Stufe der Dichte-Staffel; der Knopf trägt `controlHeight` (30 / 48 / 72).
 * Abstand `paddingSM` wie die übrigen Kopfwerkzeuge (LLH-1227). Ohne Filter rendert nichts.
 */
export function FilterChips({
  filter,
  onEntfernen,
}: {
  filter: readonly AktiverFilter[];
  onEntfernen: (spalte: string, wert: string) => void;
}) {
  const { token } = theme.useToken();
  if (filter.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Aktive Filter"
      data-lfh="filterchips"
      style={{ display: 'flex', flexWrap: 'wrap', gap: token.paddingSM }}
    >
      {filter.map((f) => (
        <Button
          key={`${f.spalte}\u0000${f.wert}`}
          aria-label={`Filter ${f.text} entfernen`}
          onClick={() => onEntfernen(f.spalte, f.wert)}
          icon={
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <IconKreuz />
            </span>
          }
          iconPlacement="end"
        >
          {f.text}
        </Button>
      ))}
    </div>
  );
}
