/**
 * Filter für antds CSS-Variablen im Testlauf (LFH-623).
 *
 * **Das Problem, gemessen:** antd 6 hängt an jedes Bedienelement die Klasse
 * `css-var-root`, und die zugehörigen Regeln tragen die gesamte Token-Tabelle als
 * Custom Properties. Ein nackter antd-Knopf kommt unter jsdom 30 damit auf **495**
 * berechnete Eigenschaften, davon **464** `--ant-*`-Variablen. jsdoms `getComputedStyle`
 * schleppt jede davon durch die Kaskade (`handleProperty` → `Specificity.calculate`
 * je Eigenschaft) — und auch der Cache-Treffer ist nicht billig: `getComputedStyleDeclaration`
 * klont die zwischengespeicherte Deklaration Eigenschaft für Eigenschaft
 * (`computed-style.js`, `getPropertyValue` + `setProperty` je Eintrag). Ein warmer Cache
 * rettet also nichts; teuer ist die **Zahl** der Eigenschaften. `*ByRole` ruft
 * `getComputedStyle` für jedes Element mit Rolle UND dessen Vorfahren (Sichtbarkeit),
 * auf der Lagekarte kostete ein einzelnes `getByRole` so 2,4–2,6 s.
 *
 * **Nicht die Ursache**, obwohl es naheliegt: jsdom löst `var()` gar nicht auf
 * (`CSSStyleDeclaration-impl.js`: „TODO: Resolve css var()"). Ein `color: var(--ant-…)`
 * bleibt als Zeichenkette stehen, mit oder ohne Variablendefinition.
 *
 * **Warum hier und nicht per Konfiguration:** `ConfigProvider theme={{ cssVar: false }}`
 * wirkt in antd 6 nicht — gemessen, die 464 Variablen bleiben. `useToken` baut den
 * cssVar-Schlüssel bedingungslos (`ctxCssVar?.key ?? 'css-var-root'`), die Weiche aus
 * antd 5 gibt es nicht mehr.
 *
 * **Was der Filter tut:** er entfernt aus den Stilen, die antds CSS-in-JS über
 * `@rc-component/util`s `updateCSS` einhängt, jede Custom-Property-DEKLARATION. Alles
 * andere bleibt: Selektoren, `display: none` der geschlossenen Portale und versteckten
 * Reiter, jeder Wert, der ein `var()` enthält. Da jsdom `var()` ohnehin nicht auflöst,
 * ändert sich an keiner berechneten Standard-Eigenschaft etwas — verloren geht nur die
 * Abfrage `getPropertyValue('--ant-…')`, und die stellt kein Test (gezählt 22.09.2026).
 *
 * **Erkannt wird ein antd-Stil am Attribut `data-rc-order`**, das `updateCSS` VOR dem
 * Setzen von `innerHTML` anbringt. Ein Test, der selbst ein `<style>` baut, bleibt
 * unberührt.
 *
 * **Der Getter liefert den ungefilterten Text zurück** — und das ist tragend, nicht
 * Kosmetik: `updateCSS` vergleicht `existNode.innerHTML !== css`, bevor es neu schreibt,
 * und `cssinjs/util/cacheMapUtil.js` liest `style.innerHTML` zurück. Gäbe der Getter den
 * gefilterten Text her, schriebe jede Aktualisierung den Stil neu und leerte dabei jsdoms
 * Stil-Cache.
 */

/** Custom Property nur am Anfang einer Deklaration — also direkt nach `{` oder `;`. Ein
 *  Selektor wie `.a--b:hover` hat davor einen Buchstaben und bleibt stehen. */
const CUSTOM_PROPERTY = /(?<=[{;]\s*)--[\w-]+\s*:[^;{}]*;?/g;

/** Entfernt alle Custom-Property-Deklarationen aus einem Stylesheet-Text. Rein und
 *  exportiert, damit die Grenzfälle ohne DOM prüfbar sind. */
export function ohneCustomProperties(css: string): string {
  return css.replace(CUSTOM_PROPERTY, '');
}

const UNGEFILTERT = Symbol('ungefilterter Stiltext');
/** Gemerkt wird das Paar: der Originaltext gilt nur, solange der Knoten noch den daraus
 *  gefilterten Text trägt. Schreibt jemand am Filter vorbei (`textContent`), fällt der
 *  Getter auf den tatsächlichen Inhalt zurück, statt einen veralteten zu behaupten. */
type StilKnoten = HTMLStyleElement & { [UNGEFILTERT]?: { roh: string; gefiltert: string } };

/** Hängt den Filter an `HTMLStyleElement.prototype.innerHTML`. Einmal je Testdatei aus
 *  `setup.ts`, vor dem ersten Render — antd schreibt seine Stile erst beim Mounten. */
export function installiereCssVariablenFilter(): void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  // Laut statt still: ein Filter, der beim nächsten jsdom-Sprung wegfällt, machte die
  // Suite wieder langsam, ohne dass ein Test rot würde.
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
