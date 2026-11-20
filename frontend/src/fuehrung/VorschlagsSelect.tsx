import { useRef, useState, type KeyboardEvent } from 'react';
import type { RefSelectProps } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { Select } from '../components/Select';

/** Ein Eintrag der Liste: Wert und sichtbare Beschriftung. */
export interface VorschlagsOption {
  value: string;
  label: string;
}

/** Eine Gruppe der Liste; ohne `label` stehen die Einträge ohne Überschrift. */
export interface VorschlagsGruppe {
  label?: string;
  options: readonly VorschlagsOption[];
}

/**
 * Schlüssel des Freitext-Eintrags. Ein unsichtbares Zeichen, das niemand tippt; kein Wert der
 * Aufrufer beginnt damit.
 */
const FREITEXT_SCHLUESSEL = '⁠freitext';

const KEINE_WERTE: string[] = [];

/** Der letzte Listeneintrag, wie im `StammdatenFeld`. */
const freitextBeschriftung = (text: string) => `„${text}“ als Freitext übernehmen`;

const klein = (s: string) => s.toLocaleLowerCase('de');

/**
 * Vorschlagsfeld mit mehreren Werten aus Stammdaten oder frei (LLH-1753): die Tastaturregel des
 * `components/StammdatenFeld.tsx` (Spec `stammdaten-feld`, „Tastatur“; Regel `frontend/AGENTS.md`,
 * Erfassungs-Norm) für ein Mehrfach-Select. Getragen von `EmpfaengerWahl` und `EinWertAuswahl`.
 *
 * - Beim Tippen ist der oberste Stammdatentreffer markiert, ↓/↑ verschieben die Markierung.
 *   Enter und Tab nehmen den markierten Eintrag und schließen die Liste; Tab springt danach regulär
 *   weiter (kein `preventDefault`). Umschalt+Tab nimmt nichts.
 * - Freitext nur über den letzten Eintrag „„<Text>“ als Freitext übernehmen“. Passt kein Treffer,
 *   steht er zuoberst und ist damit markiert, vor den Einträgen, die erst der Tipptext bildet
 *   (`zusatz`, etwa „Fachberater: <Text>“); die markiert das Feld nie von selbst.
 * - Ohne Tippen oder Pfeilmarkierung nehmen Enter und Tab nichts. Verlassen nimmt nichts, mit
 *   `freitextBeimVerlassen` den Tipptext nur, wenn kein Treffer passt.
 * - Das Komma trennt: „Lagezentrum, ILS,“ nimmt jeden fertigen Teil als Freitext, wie zuvor im
 *   Tags-Modus (kein Rückschluss vom Text auf einen Treffer, `fuehrung/AGENTS.md`).
 *
 * Kein `allowClear`: antd setzt dafür einen echten Knopf ins Feld, und Tab landete dort statt im
 * nächsten Feld. Werte gehen über ihr Kreuz oder die Rücktaste.
 *
 * Warum nicht `mode="tags"`: rc-select stellt dort den Tipptext als ersten Eintrag vor die Treffer
 * und markiert ihn, Enter nahm „Logistikt“ statt „Logistiktrupp“; Tab nahm im Browser den
 * markierten Eintrag und hielt den Fokus fest (`OptionList`, `preventDefault`). Deshalb
 * `mode="multiple"` mit eigener Liste, und Enter, Tab und Escape der offenen Liste nimmt das Feld
 * selbst, bevor rc-select sie sieht (Erfassungsphase).
 */
export function VorschlagsSelect({
  gruppen,
  zusatz,
  value,
  onChange,
  maxCount,
  freitextBeimVerlassen = false,
  ...rest
}: {
  gruppen: readonly VorschlagsGruppe[];
  /** Einträge, die erst der Tipptext bildet; nie von selbst markiert. */
  zusatz?: (text: string) => VorschlagsOption[];
  value?: string[];
  onChange?: (werte: string[]) => void;
  /** Höchstzahl der Werte; ein Eintrag darüber hinaus wird nicht genommen. */
  maxCount?: number;
  /**
   * Verlassen nimmt den Tipptext als Freitext, aber nur, wenn kein Treffer passt (Ein-Wert-Felder,
   * Entscheidung 20.11.2026: „Florian Leitung“ + „Speichern“ geht nicht verloren). Passt ein
   * Treffer, nimmt Verlassen nichts, weder Fragment noch Treffer.
   */
  freitextBeimVerlassen?: boolean;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<RefSelectProps>(null);
  const [suche, setSucheState] = useState('');
  /**
   * Der Tipptext ohne Renderverzug: ein Tab nimmt den Eintrag und verlässt das Feld im selben
   * Ereignis, das Verlassen danach sieht so schon die geleerte Suche.
   */
  const sucheRef = useRef('');
  const setSuche = (neu: string) => {
    sucheRef.current = neu;
    setSucheState(neu);
  };
  const [offen, setOffen] = useState(false);
  /** Der markierte Eintrag, wie rc-select ihn meldet (Vorgabe, Pfeile, Maus). */
  const aktivRef = useRef<string | null>(null);
  /** Hat die Person seit dem Öffnen mit ↓/↑ markiert? */
  const pfeilRef = useRef(false);
  /**
   * Beschriftungen aller je gezeigten Einträge: ein gewählter „Fachberater: THW“ steht nach dem
   * Leeren der Suche in keiner Liste mehr und zeigte sonst seinen Code.
   */
  const beschriftungRef = useRef(new Map<string, string>());

  const werte = value ?? KEINE_WERTE;
  const text = suche.trim();

  const gefiltert = gruppen
    .map((g) => ({
      ...g,
      options: text ? g.options.filter((o) => klein(o.label).includes(klein(text))) : g.options,
    }))
    .filter((g) => g.options.length > 0);
  const treffer = gefiltert.flatMap((g) => g.options);
  const zusatzOptionen = text ? (zusatz?.(text) ?? []) : [];
  const exakt = treffer.some((o) => klein(o.label) === klein(text));
  const freitext: VorschlagsOption | null =
    text && !exakt ? { value: FREITEXT_SCHLUESSEL, label: freitextBeschriftung(text) } : null;

  for (const o of [...treffer, ...zusatzOptionen]) beschriftungRef.current.set(o.value, o.label);

  const alsOption = (o: VorschlagsOption): DefaultOptionType => ({
    value: o.value,
    label: o.label,
    title: o.label,
  });
  const freitextOption: DefaultOptionType | null = freitext && {
    ...alsOption(freitext),
    'data-lfh': 'freitext-eintrag',
  };
  const gruppenOptionen = gefiltert.flatMap((g): DefaultOptionType[] =>
    g.label
      ? [{ label: g.label, title: g.label, options: g.options.map(alsOption) }]
      : g.options.map(alsOption),
  );
  const optionen: DefaultOptionType[] =
    treffer.length > 0
      ? [
          ...gruppenOptionen,
          ...zusatzOptionen.map(alsOption),
          ...(freitextOption ? [freitextOption] : []),
        ]
      : [...(freitextOption ? [freitextOption] : []), ...zusatzOptionen.map(alsOption)];
  /** Alle Einträge in der Folge der Liste; der erste ist ohne Pfeil markiert. */
  const folge = [
    ...(treffer.length > 0 ? [...treffer, ...zusatzOptionen] : []),
    ...(freitext ? [freitext] : []),
    ...(treffer.length > 0 ? [] : zusatzOptionen),
  ].map((o) => o.value);
  // Gewählte Werte, die gerade in keiner Liste stehen, behalten ihre Beschriftung.
  const gewaehlteOhneListe: DefaultOptionType[] = werte
    .filter((w) => !folge.includes(w) && beschriftungRef.current.has(w))
    .map((w) => ({
      value: w,
      label: beschriftungRef.current.get(w)!,
      title: beschriftungRef.current.get(w)!,
      style: { display: 'none' },
      disabled: true,
    }));

  const listeOffen = offen && optionen.length > 0;

  function schliesse() {
    pfeilRef.current = false;
    setOffen(false);
  }

  function markierterEintrag(): string | null {
    if (!text && !pfeilRef.current) return null;
    const aktiv = aktivRef.current;
    if (aktiv != null && folge.includes(aktiv)) return aktiv;
    return folge[0] ?? null;
  }

  function fuegeHinzu(neue: string[]) {
    let liste = [...werte];
    for (const n of neue) if (n && !liste.includes(n)) liste.push(n);
    if (maxCount != null) liste = liste.slice(0, maxCount);
    if (liste.length !== werte.length) onChange?.(liste);
  }

  function nimm(schluessel: string) {
    fuegeHinzu([schluessel === FREITEXT_SCHLUESSEL ? text : schluessel]);
    setSuche('');
    schliesse();
  }

  function beiSuche(eingabe: string) {
    if (eingabe.includes(',')) {
      const teile = eingabe.split(',');
      const letzter = teile.pop() ?? '';
      // Fertige Teile bleiben Freitext: kein Rückschluss vom Text auf einen Treffer
      // (`fuehrung/AGENTS.md`).
      fuegeHinzu(teile.map((t) => t.trim()).filter(Boolean));
      setSuche(letzter);
      return;
    }
    setSuche(eingabe);
    pfeilRef.current = false;
    if (eingabe) setOffen(true);
  }

  function beiTasteVorab(e: KeyboardEvent<HTMLElement>) {
    if ((e.target as HTMLElement).getAttribute('role') !== 'combobox') return;
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || !listeOffen) return;
      // Selbst nehmen: rc-select schaltete den markierten Eintrag um (auch ab).
      e.preventDefault();
      e.stopPropagation();
      const eintrag = markierterEintrag();
      if (eintrag) nimm(eintrag);
      else schliesse();
      return;
    }
    if (e.key === 'Tab') {
      if (!listeOffen) return;
      // Nie `preventDefault`: der Browser bewegt den Fokus weiter.
      e.stopPropagation();
      const eintrag = e.shiftKey ? null : markierterEintrag();
      if (eintrag) nimm(eintrag);
      else schliesse();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (listeOffen) pfeilRef.current = true;
      return;
    }
    if (e.key === 'Escape' && listeOffen) {
      // Selbst schließen: ein Dialog darüber bekäme das Escape sonst mit.
      e.stopPropagation();
      schliesse();
    }
  }

  return (
    <span style={{ display: 'block' }} onKeyDownCapture={beiTasteVorab}>
      <Select<string[]>
        {...rest}
        ref={ref}
        mode="multiple"
        maxCount={maxCount}
        value={werte}
        options={[...optionen, ...gewaehlteOhneListe]}
        open={listeOffen}
        onOpenChange={(auf) => {
          if (auf) setOffen(true);
          else schliesse();
        }}
        showSearch={{
          searchValue: suche,
          onSearch: beiSuche,
          filterOption: false,
          autoClearSearchValue: false,
        }}
        onActive={(v) => {
          aktivRef.current = v == null ? null : String(v);
        }}
        // Klick auf einen Eintrag; die Tastatur nimmt `beiTasteVorab`.
        onSelect={(v: string) => nimm(v)}
        // Abwählen per Klick in der Liste, Entfernen eines Wertes, Leeren.
        onDeselect={(v: string) => onChange?.(werte.filter((w) => w !== v))}
        onBlur={() => {
          const getippt = sucheRef.current.trim();
          if (freitextBeimVerlassen && getippt && treffer.length === 0) fuegeHinzu([getippt]);
          setSuche('');
          schliesse();
        }}
      />
    </span>
  );
}
