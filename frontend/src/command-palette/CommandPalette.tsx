// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal, Input, theme, type InputRef } from 'antd';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { form } from '../theme/tokens';
import { filtereBefehle, filtereNachModus, modiMitPraefix, ohneOrdnungsdubletten, ordneTreffer, parsePraefix } from './fuzzy';
import { GRUPPEN_LABEL, GRUPPEN_REIHENFOLGE, PALETTE_MODI, type Befehl } from './typen';
import { palettenZeilenStil } from './zeilenStil';

interface Props {
  befehle: Befehl[];
  schliesse: () => void;
}

/** Präsentationale Palette: Suche + gruppierte, tastaturbedienbare Trefferliste. */
export function CommandPalette({ befehle, schliesse }: Props) {
  const { token } = theme.useToken();
  const [suche, setSuche] = useState('');
  const [aktiv, setAktiv] = useState(0);
  const listeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // Fokus sicherstellen: antd Modal kann den Fokus nach Mount verschieben.
  useEffect(() => { inputRef.current?.focus(); }, []);

  /**
   * Präfixmodus (LFH-391 · A4): das Zeichen am Anfang schränkt auf Befehlsgruppen ein, der
   * Rest ist der eigentliche Suchbegriff. Beides sind Primitive — die `useMemo` darunter
   * hängen damit an Werten statt an einer je Anschlag neuen Objektidentität.
   *
   * DIE EINZIGE Aufrufstelle des Parsers. Der Modus greift VOR dem Fuzzy-Filter: Fuse
   * bewertete sonst Befehle mit, die der Modus ohnehin verwirft.
   */
  const { modus, rest } = useMemo(() => parsePraefix(suche), [suche]);
  const gefiltertNachModus = useMemo(() => filtereNachModus(befehle, modus), [befehle, modus]);

  // Die Ordnungsgruppe `zuletzt` fällt weg, SOBALD gesucht wird — sonst stünden ihre
  // Einträge flach neben ihren label-gleichen Modul-Zwillingen. Vor `filtereBefehle`, damit
  // Fuse nicht über Befehle bewertet, die ohnehin niemand sieht.
  const imModus = useMemo(
    () => (rest === '' ? gefiltertNachModus : ohneOrdnungsdubletten(gefiltertNachModus)),
    [gefiltertNachModus, rest],
  );

  const treffer = useMemo(() => filtereBefehle(imModus, rest), [imModus, rest]);
  /**
   * Zwei Zustände, zwei Ordnungen (LFH-391 · A3):
   *
   * Bei LEERER Suche gilt die kuratierte Startansicht aus LFH-337 · M11 —
   * `GRUPPEN_REIHENFOLGE` mit Überschriften, „das Nützlichste zuerst".
   *
   * Bei AKTIVER Suche ordnet die Bewertung, flach und gruppenübergreifend. Die Gruppenachse
   * zerstörte hier die Trefferordnung: gemessen an fuse.js 7.5.0 stand für 'etb' die
   * Schnellaktion „Neue Person erfassen" (Score 5.77e-1, reines Rauschen) vor dem genauen
   * Modultreffer (8.60e-9), weil `schnellaktionen` vor `module` steht. Und eine
   * Gruppenüberschrift über einer score-sortierten Liste behauptete eine Ordnung, die es
   * dann nicht mehr gibt.
   */
  // Massgeblich ist der REST, nicht die rohe Eingabe: ein nacktes '>' schränkt ein, sucht
  // aber nicht — dort gilt weiterhin die kuratierte Startansicht, nur mit weniger Gruppen.
  const sucheAktiv = rest !== '';

  const gruppen = useMemo(
    () => (sucheAktiv
      ? []
      : GRUPPEN_REIHENFOLGE
        .map((g) => ({ gruppe: g, items: treffer.map((t) => t.befehl).filter((b) => b.gruppe === g) }))
        .filter((x) => x.items.length > 0)),
    [treffer, sucheAktiv],
  );
  // EINZIGE Indexquelle für beide Zweige: `indexVon`, `aria-activedescendant`,
  // `aria-expanded`, der Leerzustand und `aufTaste` lesen ausschliesslich von hier.
  const flach = useMemo(
    () => (sucheAktiv ? ordneTreffer(treffer, rest) : gruppen.flatMap((x) => x.items)),
    [sucheAktiv, treffer, rest, gruppen],
  );
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);

  useEffect(() => { setAktiv(0); }, [suche]);

  // aktiven Eintrag in den Sichtbereich scrollen
  useEffect(() => {
    const el = listeRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [aktiv]);

  function fuehreAus(b: Befehl | undefined) {
    if (!b) return;
    schliesse();
    b.ausfuehren();
  }

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv((i) => (flach.length ? (i + 1) % flach.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv((i) => (flach.length ? (i - 1 + flach.length) % flach.length : 0)); }
    else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      fuehreAus(flach[aktiv]);
    }
  }

  const aktiverId = flach[aktiv]?.id;

  /**
   * EINE Zeile für BEIDE Zweige (LFH-391 · A3). Zwei Kopien wären zwei Orte, an denen der
   * Bedienziel-Boden aus LFH-365 still verlorengehen kann — ein Inline-Padding sieht kein
   * Guard. Der Boden selbst kommt aus `palettenZeilenStil`, siehe dort.
   */
  function optionsZeile(b: Befehl) {
    const i = indexVon.get(b.id)!;
    const istAktiv = i === aktiv;
    const Icon = b.icon;
    return (
      <div
        key={b.id}
        id={`cmd-${b.id}`}
        role="option"
        aria-selected={istAktiv}
        onMouseEnter={() => setAktiv(i)}
        onClick={() => fuehreAus(b)}
        style={{
          ...palettenZeilenStil(token),
          background: istAktiv ? token.colorPrimaryBg : 'transparent',
          color: istAktiv ? token.colorPrimary : token.colorText,
        }}
      >
        {Icon && <Icon size={18} />}
        <span>{b.label}</span>
        {b.kuerzel && <Tastenkuerzel style={{ marginLeft: 'auto' }}>{b.kuerzel}</Tastenkuerzel>}
      </div>
    );
  }

  return (
    <Modal
      open
      keyboard={false}
      onCancel={schliesse}
      footer={null}
      closable={false}
      width={640}
      zIndex={2000}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div>
        <Input
          ref={inputRef}
          autoFocus
          variant="borderless"
          size="large"
          placeholder="Suchen: Module, Aktionen, Einstellungen …"
          role="combobox"
          aria-expanded={flach.length > 0}
          aria-controls="cmd-liste"
          aria-activedescendant={aktiverId ? `cmd-${aktiverId}` : undefined}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={aufTaste}
          style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        />
        {/*
          * Die Modusanzeige (LFH-391 · A4) — sichtbarer Gegenpart zu einem Filter, der die
          * Liste um zwei Drittel kürzt. Sie beantwortet zwei Fragen: WIE komme ich hinein
          * (Legende, solange nichts getippt ist) und BIN ich drin (Wortlaut, solange der
          * Modus steht). Ohne die zweite Hälfte wäre der aktive Modus von einem kaputten
          * Filter nicht zu unterscheiden — auf dem Berührungsweg sieht niemand die getippte
          * Zeile als Syntax.
          *
          * BEDINGT, nicht dauerhaft: bei gewöhnlicher Suche kostet sie sonst eine der rund
          * sieben Zeilen, die der Fükw-Schirm zeigt. Der Tastaturvertrag steht damit in der
          * Steuerzeile und NICHT im Platzhalter (CLAUDE.md, Nacharbeit zu LFH-335) — der
          * Platzhaltertext bleibt byte-gleich, womit auch die fünf e2e-Locator halten.
          *
          * Rollen statt Werte (LFH-352): Sekundärfarbe, kleine Schrift, Abstandsrollen.
          * KEIN Bedienziel — Satz, kein Ziel, also kein `controlHeight`-Boden.
          */}
        {(modus !== 'alles' || rest === '') && (
          <div
            data-lfh="palette-modus"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token.margin,
              padding: `${token.paddingXS}px ${token.paddingSM}px`,
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
            }}
          >
            {modus === 'alles'
              ? modiMitPraefix().map((m) => (
                // Das Präfixzeichen als Marke, nicht als Satzzeichen im Fliesstext: ein
                // nacktes '>' hat weder Rahmen noch Abstand zum Nachbarn — JSX verschluckt
                // den Umbruch zwischen zwei Elementen ersatzlos, deshalb die Flex-Zeile
                // mit `gap` statt eines Leerzeichens.
                <span
                  key={m.modus}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}
                >
                  <Tastenkuerzel>{m.praefix}</Tastenkuerzel>
                  {m.legende}
                </span>
              ))
              : PALETTE_MODI[modus].hinweis}
          </div>
        )}
        <div
          id="cmd-liste"
          role="listbox"
          ref={listeRef}
          // `min(60vh, 480px)` statt der festen 380 (LFH-337 · M11): auf dem Fükw-Schirm
          // zeigte der Kasten von 42+ Befehlen rund sieben. Die Obergrenze bleibt, damit
          // die Liste auf einem hohen Schirm nicht die ganze Seite füllt; `60vh` deckelt
          // sie auf niedrigen Schirmen, wo 480 px über den Rand liefen.
          style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', padding: token.paddingXS }}
        >
          {flach.length === 0 && (
            <div style={{ padding: token.padding, color: token.colorTextSecondary }}>Keine Treffer</div>
          )}
          {sucheAktiv && flach.map((b) => optionsZeile(b))}
          {gruppen.map((x) => (
            <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
              <div
                style={{
                  padding: `${token.paddingXS}px ${token.paddingSM}px`,
                  fontSize: token.fontSizeSM,
                  textTransform: 'uppercase',
                  // Versalien ohne Sperrung sind der Grund, warum eine
                  // Gruppenüberschrift „gedrängt" aussieht — LFH-352 hält den Wert
                  // als Formrolle, statt ihn je Stelle zu erfinden.
                  letterSpacing: form.versalSperrung,
                  color: token.colorTextSecondary,
                }}
              >
                {GRUPPEN_LABEL[x.gruppe]}
              </div>
              {x.items.map((b) => optionsZeile(b))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
