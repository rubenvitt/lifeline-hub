/**
 * Filter für antds CSS-Variablen im Testlauf (LFH-623).
 *
 * **Problem:** antd 6 hängt an jedes Bedienelement `css-var-root`, dessen Regeln die ganze
 * Token-Tabelle als Custom Properties tragen (~464 `--ant-*` je Element). jsdoms
 * `getComputedStyle` zahlt je Eigenschaft, auch aus dem Cache (er klont Eintrag für Eintrag);
 * `*ByRole` ruft es für jedes Element mit Rolle und dessen Vorfahren — auf der Lagekarte
 * kostete ein `getByRole` so über 2 s.
 *
 * `ConfigProvider theme={{ cssVar: false }}` wirkt in antd 6 nicht; `useToken` baut den
 * cssVar-Schlüssel bedingungslos.
 *
 * **Der Filter** entfernt aus den Stilen, die antds CSS-in-JS über `updateCSS` einhängt, jede
 * Custom-Property-DEKLARATION. Selektoren, `display: none` und Werte mit `var()` bleiben. Da
 * jsdom `var()` ohnehin nicht auflöst, ändert sich keine berechnete Standard-Eigenschaft;
 * verloren geht nur `getPropertyValue('--ant-…')`, die kein Test stellt.
 *
 * Erkannt wird ein antd-Stil am Attribut `data-rc-order`, das `updateCSS` VOR `innerHTML`
 * setzt; eigene `<style>` von Tests bleiben unberührt.
 *
 * **Der Getter liefert den ungefilterten Text zurück** — tragend: `updateCSS` vergleicht
 * `existNode.innerHTML !== css` und `cacheMapUtil` liest `innerHTML` zurück. Gäbe der Getter
 * den gefilterten Text her, schriebe jede Aktualisierung den Stil neu und leerte jsdoms
 * Stil-Cache.
 */

/**
 * Custom Property nur am Anfang einer Deklaration — direkt nach `{` oder `;`; ein Selektor
 * wie `.a--b:hover` bleibt stehen.
 * Grenze: der Wert endet am ersten `;`, `{` oder `}`, auch in einem String oder einer
 * Data-URI. Kein heutiges Token trägt so einen Wert; eines mit Data-URI hinterließe kaputtes CSS.
 */
const CUSTOM_PROPERTY = /(?<=[{;]\s*)--[\w-]+\s*:[^;{}]*;?/g;

/** Entfernt alle Custom-Property-Deklarationen aus einem Stylesheet-Text. Rein und
 *  exportiert, damit die Grenzfälle ohne DOM prüfbar sind. */
export function ohneCustomProperties(css: string): string {
  return css.replace(CUSTOM_PROPERTY, '');
}

const UNGEFILTERT = Symbol('ungefilterter Stiltext');
/**
 * Gemerkt wird das Paar: der Originaltext gilt nur, solange der Knoten noch den daraus
 * gefilterten Text trägt. Schreibt jemand am Filter vorbei (`textContent`), fällt der Getter
 * auf den tatsächlichen Inhalt zurück.
 */
type StilKnoten = HTMLStyleElement & { [UNGEFILTERT]?: { roh: string; gefiltert: string } };

/** Hängt den Filter an `HTMLStyleElement.prototype.innerHTML`. Einmal je Testdatei aus
 *  `setup.ts`, vor dem ersten Render — antd schreibt seine Stile erst beim Mounten. */
export function installiereCssVariablenFilter(): void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  // Laut statt still: fiele der Filter beim nächsten jsdom-Sprung weg, würde die Suite wieder
  // langsam, ohne dass ein Test rot würde.
  if (!original?.get || !original.set) {
    throw new Error('LFH-623: Element.prototype.innerHTML ist kein Accessor mehr');
  }
  const { get, set } = original;
  Object.defineProperty(HTMLStyleElement.prototype, 'innerHTML', {
    configurable: true,
    enumerable: original.enumerable,
    get(this: StilKnoten) {
      const tatsaechlich = get.call(this) as string;
      const gemerkt = this[UNGEFILTERT];
      return gemerkt && gemerkt.gefiltert === tatsaechlich ? gemerkt.roh : tatsaechlich;
    },
    set(this: StilKnoten, wert: string) {
      if (!this.hasAttribute('data-rc-order')) {
        delete this[UNGEFILTERT];
        set.call(this, wert);
        return;
      }
      const gefiltert = ohneCustomProperties(wert);
      set.call(this, gefiltert);
      // Zurückgelesen statt `gefiltert` gemerkt: der Parser darf den Text normalisieren.
      this[UNGEFILTERT] = { roh: wert, gefiltert: get.call(this) as string };
    },
  });
}
