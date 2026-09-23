# Design

## Context

Eine Palettenzeile ist ein `Befehl` mit einem geschlossenen `ausfuehren: () => void` (siehe
`command-palette/typen.ts`). Das Navigationsziel steckt heute nur in dieser Closure, und
zwar an drei Bauorten: `befehle.ts` (statische Befehle), `datensaetze.ts` (Treffer und
ETB-Sammeltreffer) und `koordinatenSprung.ts`. Nebenwirkungen hängen ebenfalls an der
Closure. `merkeModulBesuch` wickelt `befehle.ts` direkt ein, `merkeBefehl` legt
`mitGedaechtnis` darum. Gedächtniszeilen sind Kopien per Spread (`...treffer`) und
übernehmen damit jedes zusätzliche Feld des Originals.

Tasten behandelt `CommandPalette.aufTaste` am Suchfeld. Esc schließt die Palette **nicht**
dort, sondern im globalen `keydown`-Handler des Providers
(`tastaturAktionFuerEreignis` → `verwerfen`). Dieser Handler bricht bei
`e.defaultPrevented` ab. Außerdem bindet er Strg/⌘+↵ global an `speichern`.

Die Sitzung liegt im Cookie (`credentials: 'same-origin'`), und der Router läuft ohne
`basename`. Die Palettenpfade sind also direkt als URL verwendbar.

## Goals / Non-Goals

**Goals:**
- Eine Stelle entscheidet, ob eine Zeile einen neuen Tab trägt. Keine Zeile öffnet still im
  aktuellen Tab, wenn ein neuer verlangt war.
- Die Gedächtnis-Nebenwirkungen sind auf beiden Öffnungswegen identisch, ohne dass sie ein
  zweites Mal gebaut werden.
- Die Vorschau ist reine Darstellung und wird von Palette und Drawer gemeinsam genutzt.

**Non-Goals:**
- Vorschauen für andere Sorten als Personen. Sie kommen als Folgeticket; die Mechanik trägt
  sie ohne Umbau.
- Ein Tippziel für die Vorschau auf Touch-Geräten. Das ist ein eigenes Folgeticket, heute
  erreicht man die Vorschau nur per Tastatur.
- Eine geteilte Ansicht aus Liste und Vorschau. Bei 640 px Palettenbreite reicht der Platz
  dafür nicht.

## Decisions

### 1. `ziel` als Marke, Öffnungsart als Argument von `ausfuehren`

`Befehl` bekommt `ziel?: string` und die Signatur `ausfuehren: (oeffnung?: Oeffnung) => void`
mit `type Oeffnung = 'hier' | 'neuerTab'`. Die injizierten `navigate`-Callbacks in
`BefehlKontext`, `DatensatzKontext` und `koordinatenBefehl` nehmen dasselbe zweite Argument.
Jeder Navigationsbefehl reicht es durch, zum Beispiel
`ausfuehren: (o) => { k.merkeModulBesuch?.(m.key); k.navigate(ziel, o); }`.
`mitGedaechtnis` gibt das Argument weiter.

Die Palette übergibt `'neuerTab'` **nur**, wenn `b.ziel` gesetzt ist. Das ist die eine
Stelle, von der das Goal oben spricht. Befehle ohne Ziel bekommen das Argument also nie zu
sehen. Deshalb kann Strg/⌘+↵ auf „Speichern“ nicht speichern.

*Alternative verworfen:* ein zweiter Callback `imNeuenTab` je Befehl. Er hätte jede
Nebenwirkung (Modulbesuch, Gedächtnis) an zwölf Bauorten doppelt verlangt. Genau diese
Dopplung läuft auseinander, ohne dass ein Test es merkt.

*Alternative verworfen:* nur `ziel` und keine Closure. Dann wanderten die Nebenwirkungen in
die Palette, die heute nichts von Modulbesuchen weiß.

**Risiko dieser Bauform:** Ein Bauort setzt `ziel`, reicht `o` aber nicht durch. Dann öffnet
die Zeile still im aktuellen Tab. Ein Guard-Test baut alle Befehle mit vollem Kontext (jede
Gruppe belegt) und prüft für jede Zeile mit `ziel`, dass
`ausfuehren('neuerTab')` genau `navigate(ziel, 'neuerTab')` ruft. Dasselbe gilt für
Datensatz- und Koordinatenzeilen. Mutationsprobe: das `o` an einem Bauort weglassen muss den
Test rot färben.

### 2. Neuer Tab im Provider, nicht in der Palette

`PaletteHost.gehZu(pfad, oeffnung)` ruft bei `'neuerTab'` `window.open(pfad, '_blank',
'noopener')` auf, sonst `navigate(pfad)`. Die Palette bleibt damit präsentational und ohne
`window`-Zugriff. Tests setzen `window.open` als Spy ein.

### 3. Tasten: der Palette-Handler verhindert den globalen

In `aufTaste` gilt diese Reihenfolge: `isComposing` → Vorschau-Zweig → Liste.
Strg/⌘+↵ ruft **immer** `preventDefault()`, auch ohne Ziel. Sonst griffe der globale
Handler und löste `speichern` der Seite unter der Palette aus. Esc und ← im Vorschau-Zweig
rufen `preventDefault()` aus demselben Grund, denn sonst schlösse der globale `verwerfen`
die Palette. Ob React-Handler im Portal der Palette vor dem `window`-Listener laufen, ist
gemessen zu belegen. Ein Test prüft deshalb „Esc aus der Vorschau lässt die Palette offen“
über den echten Provider, nicht über die präsentationale Palette allein.

→ greift nur bei `selectionStart === selectionEnd === value.length` und nur, wenn die
markierte Zeile eine `vorschau` hat. In jedem anderen Fall bleibt → unbehandelt. Das
entspricht dem Autovorschlag in fish.

Strg/⌘+Klick auf eine Zeile nimmt denselben Weg wie Strg/⌘+↵.

### 4. Vorschau als Datum am Befehl, Darstellung in der Palette

`Befehl.vorschau?: VorschauZiel` mit `type VorschauZiel = { art: 'person'; einsatzId: number;
id: number }` als diskriminierte Union. `befehlFuer` in `datensaetze.ts` setzt sie für
`modulKey === 'personen'`. `command-palette/Vorschau.tsx` bildet `art` in einem
exhaustiven `switch` mit `never`-Zweig auf die Komponente ab. Eine neue Sorte bricht damit
den Typcheck, statt still zu fehlen.

Die Palette hält den Zustand `vorschau: Befehl | null` als **Objekt, nicht als Id**. Kommen
während der offenen Vorschau neue Datensatztreffer an, darf die gezeigte Person nicht
verschwinden, weil ihre Zeile aus `flach` gefallen ist. Der Rückweg setzt nur `vorschau`
zurück. `aktivId` und `suche` bleiben unberührt, damit stehen Begriff und Markierung
wieder da. `onChange` des Suchfelds setzt `vorschau` auf `null`.

Die Listbox wird während der Vorschau **nicht** gerendert, stattdessen erscheint eine
Region (`role="region"`, `aria-label="Vorschau: <Label>"`). Das Suchfeld behält den Fokus,
`aria-expanded` ist `false`, `aria-activedescendant` entfällt. Die Kopfzeile der Region
trägt einen antd-`Button` „Zurück“. Er erbt `controlHeight` und braucht deshalb keine
handgebaute Bedienziel-Zusicherung. Die Höhe der Region folgt demselben Deckel wie die
Liste (`min(60vh, 480px)`) und scrollt darin.

### 5. `PersonVorschau` aus `PersonDetailDrawer` herauslösen

`personen/PersonVorschau.tsx` übernimmt Query, Lade- und Fehlerzustand sowie den Inhalt:
Tags, `Descriptions` und `PersonVerlauf`. Der Drawer behält Rahmen, Titel und „Vollständig
öffnen“. Er liest für den Titel denselben Query-Key und damit dasselbe Cache-Fach, es
entsteht kein zweiter Request. Der Dateiname hat ein anderes Basisnamen-Präfix als der
Drawer, die `.ts`/`.tsx`-Kollision aus LFH-347 tritt also nicht auf.

### 6. Fußzeile statisch, Marke an der Zeile

Die Fußzeile bricht bei 640 px schon heute um. Ein Hinweis, der beim Pfeilen je Zeile
erscheint und verschwindet, änderte ihre Zeilenzahl und ließe die Palette springen. Deshalb
sind die Hinweise statisch: `⌘↵`/`Strg+↵ neuer Tab` immer, `→ Vorschau` nur mit Einsatz,
nach dem Muster des Koordinatenhinweises. Die zeilengenaue Aussage trägt die `→`-Marke an
der aktiven Zeile, `aria-hidden` wie die ↵-Marke daneben. Die Plattformweiche nutzt den
User-Agent-Test aus `befehle.ts` (`/Mac|iPhone|iPad|iPod/`). Das Kürzel steht als
`Tastenkuerzel`-Marke und nicht als Text.

## Risks / Trade-offs

- [Mehr Tabs belegen ohne TLS die 6 HTTP/1.1-Verbindungen je Origin, weil jeder
  Einsatz-Tab eine SSE hält] → Das Risiko besteht mit Strg+Klick auf Navigationslinks heute
  schon. Mit TLS spricht der Server HTTP/2. Es wird im Proposal benannt, nicht technisch
  abgefangen.
- [Ein neuer Tab ist immer ein Kaltstart, und Deeplinks mit Parametern wie `?neu=1`,
  `?zentrum=` oder `?eintrag=` wirken dort ohne warmen Cache] → Der e2e-Test öffnet
  mindestens eine Personendetailseite und den Koordinatensprung im neuen Tab und prüft den
  geladenen Zustand. Scheitert ein Deeplink kalt, wird das ein Folgeticket, das diesen
  Umfang nicht aufbläht.
- [→ im Suchfeld ist eine Cursor-Taste] → Die Vorschau greift nur am Textende und nur bei
  einer Zeile mit Vorschau. Beide Bedingungen werden als Paar getestet.
- [Touch-Nutzer erreichen die Vorschau nicht] → Bewusst ausgeklammert und als Folgeticket
  angelegt. Den neuen Tab bietet der Browser dort ohnehin kaum an.
- [jsdom verschiebt den Fokus nicht in Portale und rechnet kein Layout] → Den Rückweg per
  Esc belegt auch e2e. Die Vitest-Tests prüfen Zustand und Aufrufe.
