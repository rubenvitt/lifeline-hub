# LFH-338 · Prüfliste Einsatztauglichkeit

Angelegt an die Flächen, die LFH-338 (C3) umgebaut hat: die Kräfteübersicht
(`pages/KraefteuebersichtPage.tsx` mit `pages/kraefteuebersichtPrint.css`), die neue
Verdichtungszeile (`kraefte/Verdichtungszeile.tsx`) und ihre vier Einbauorte
(`pages/{Fahrzeuge,Personal,Material,Einheiten}Page.tsx`) sowie der Baum-Zweig des
Primitivs (`components/Datensicht.tsx`, `expandRowByClick`).

Kriterien wörtlich aus `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7) — Nummerierung und Klauseln übernommen, nicht neu erfunden. Form nach dem
Präzedenzfall `docs/superpowers/specs/2026-08-10-lfh-337-pruefliste-einsatztauglichkeit.md`.

„Nicht geprüft" ist kein Verdikt (CLAUDE.md). Jede Zeile trägt `erfüllt` / `offen →
Zielticket` / `nicht anwendbar`, je mit Beleg oder Begründung.

**Die Kräfteübersicht ist eine Vergleichstabelle mit Druckausgabe** — anders als der
Navigationsrahmen aus LFH-337 sind hier die Zeilen 6, 7, 12 und 14 voll anwendbar und
tragen die Hauptlast der Prüfung.

## Prüfliste

| # | Kriterium | Verdikt | Begründung |
|---|---|---|---|
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei; zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand. | **erfüllt, mit einer benannten Ausnahme (Zeile unten)** | Der wichtigste Gewinn dieses Tickets: die **ganze Baumzeile** ist jetzt das Aufklapp-Ziel statt des ~16 px breiten Symbols (`Datensicht.tsx`, `expandRowByClick` im Baum-Zweig; Nachweis `Datensicht.test.tsx` „klappt beim Klick auf die ZEILE auf"). Alle neuen Bedienelemente sind echte antd-Steuerelemente ohne punktuelle `size`-Prop und erben damit die Dichte-Staffel vom `ConfigProvider`: `Segmented` (Alles aufklappen / Nur Abschnitte), `Button type="link"` (Filter zurücksetzen), `Link` (Kräfteübersicht in der Verdichtungszeile). `grep -n 'size="small"'` über `KraefteuebersichtPage.tsx` und `Verdichtungszeile.tsx` liefert **zwei** Treffer, beide an `<Space>` — ein Abstandsmaß, keine Trefffläche; genau die Trennung, aus der `components/dichte.guard.test.ts` `Card`/`Descriptions`/`Space` heraushält, und der Guard ist grün. **Ausnahme:** das Schließkreuz der Filter-Marken (`Tag closable`) ist antd-Bestand mit fester Größe (siehe „Offene Nachzüge" 1) — dieselbe Funktion ist über den vollwertigen Knopf „Filter zurücksetzen" daneben erreichbar, für alle Filter auf einmal. |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **offen → LFH-396** | Der Mechanismus greift (alle neuen Elemente hängen am `ConfigProvider`, keine punktuelle Größe), im Browser ist er für **diese** Route aber nicht gemessen. `e2e/meldebild-tabelle.spec.ts` setzt die Handschuh-Dichte an genau einer Stelle — für die Trefffläche des antd-Aufklapp-Symbols, und dort ausdrücklich **protokollierend statt zusichernd**. Für `Segmented`, Filter-Marken und Verdichtungszeile ist die 72-px-Stufe unbelegt. Dieselbe Lücke, die LFH-336 und LFH-337 bereits unter LFH-396 gebündelt haben; die Flächen von C3 gehören dort dazu. |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **erfüllt** | Filtern, Aufklappen und der Umschalter sind reine Client-Operationen ohne Serverrunde. Die einzige Aktion mit Serverantwort ist „In Lagebericht übernehmen" — sie trägt unverändert `loading={uebernehmen.isPending}` am Knopf. Der Druckpfad wartet bewusst einen Render ab (`printPending`-Effekt), bevor `window.print()` läuft. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **nicht anwendbar** | Keine der Flächen führt eine kritische oder irreversible Aktion aus. „In Lagebericht übernehmen" legt einen **Entwurf** an, der vom EL löschbar ist (Kommentar an der Mutation); Filtern, Aufklappen und Drucken sind folgenlos. |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **offen → LFH-396** | Alle Farben kommen aus dem Vertrag (`rollenFarbe`/`statusKategorie` und `token.colorText*`), kein Wert von Hand: `grep -rniE '#([0-9a-f]{3}){1,2}\b'` über `KraefteuebersichtPage.tsx`, `Verdichtungszeile.tsx` und `kraefteuebersichtPrint.css` liefert **0 Treffer**. Damit erben die drei Statuszahlen im Kopf und in der Verdichtungszeile dieselben Rollen wie die Statusspalte der Tabelle — dieselbe Bedeutung, derselbe Ton. Was **nicht** gemessen ist: die tatsächlichen Kontrastwerte dieser Rollen auf dem jeweiligen Kartengrund, in beiden Modi. jsdom rechnet keine Farbmischung, und der Playwright-Topf führt diesen Nachweis heute für keine Fläche. Gleiche Lage wie bei den Warnstufen-Füllungen aus LFH-368/B5h, die dafür bereits auf LFH-370/B5j zeigen. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **erfüllt** | Die kompakten Statuszeilen tragen die Bedeutung im **Wortlaut**, die Farbe verstärkt nur: „1 frei · 0 gebunden · 0 n. einsatzbereit" im Kopf, „… frei / … gebunden / … n. verf." in der Verdichtungszeile. Vor dem Umbau standen dort vier `Statistic` mit Titel — die Aussage ist erhalten, nicht auf Farbe reduziert worden. Gepinnt in `KraefteuebersichtPage.test.tsx` („zeigt Fahrzeug-Verfügbarkeits-Achse im Kopf", prüft **Text**, nicht Farbe) und `Verdichtungszeile.test.tsx`. Auch das Materialband nennt je Statuszahl das Wort (`label.replace('Mtl. ', '')`). |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **erfüllt** | 0 Farbliterale (Beleg in Zeile 5). Die drei Fahrzeug-Rollen sind byte-gleich dieselben wie in der Statusspalte der Tabelle darunter (`statusKategorie.verfuegbar/gebunden/nicht_verfuegbar`) — die Kopfzahl und der Tag darunter können nicht in verschiedenen Tönen sprechen. Die Verdichtungszeile nutzt exakt dieselben drei Rollen; eine vierte Bedeutung ist nicht entstanden. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** | App-weite Lücke, bereits unter LFH-336/337 dokumentiert und dort gebündelt: kein Regler existiert irgendwo in der Anwendung. Nicht seitenspezifisch und nicht im Scope von C3. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **erfüllt** | Genau das ist der Kern von Befund H6: bis zu 12 Kennzahlen lagen in einer nicht umbrechenden Reihe hinter einem Bildlauf im Karteninneren, die komplette Materialachse damit **außerhalb** des Schirms. Jetzt drei Rasterspalten, die auf einem Führungs-Tablet ohne Bildlauf stehen — gemessen in `e2e/meldebild-tabelle.spec.ts` („Monitoring-Kopf … bricht um statt waagerecht zu scrollen"): Inhaltsbreite 678 px, Inhalt 678 px, alle drei Achsen `toBeInViewport`. Mutationsprobe protokolliert: mit den alten Angaben 999 px Inhalt in 678 px Fläche. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Keine der Flächen erzeugt Alarme. Die Kräfteübersicht hat keinen eigenen Live-Stream (sie importiert `useEinsatzLiveStream` nicht — Kommentar am Zufluss-Argument der Seite), die Verdichtungszeile ebenfalls nicht. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -rn "animation\|blink\|@keyframes"` über `KraefteuebersichtPage.tsx`, `Verdichtungszeile.tsx` und `kraefteuebersichtPrint.css` liefert **0 Treffer** — kein Blinken, keine Bewegung, kein Ton. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt** | Drei bewusste Entscheidungen tragen das. **(a)** Das automatische Aufklappen greift **genau einmal** (`initialAufgeklappt`-Riegel): ohne ihn klappte jeder Neuaufbau des Baums — und `bild` hängt an sechs Queries **und** am Filter, jeder Tastendruck im Suchfeld baut ihn neu — die Handarbeit der Einsatzkraft wieder auf. Gepinnt: „klappt eine vom Benutzer zugeklappte Zeile NICHT bei jedem Datenzufluss wieder auf". **(b)** Die Verdichtungszeile rendert `null`, solange die Listen fehlen — kein Skelett, das eine Zeile hoch ein- und ausblendet und die Tabelle darunter verschiebt (Test „zeigt nichts, solange die Listen noch nicht da sind"). **(c)** Die Wahrheitszeile im Kopf steht **immer**, auch ungefiltert: erschiene sie erst bei gesetztem Filter, wäre ihr Erscheinen selbst ein Sprung. Der `zufluss="sofort"`-Vertrag des Meldebilds bleibt unverändert und ist an seiner Fundstelle begründet (die Schleuse führt nur die Wurzel-Schlüsselfolge, eine neue Disposition landet tief im Baum). |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern. | **erfüllt** | Der Umbau **entfernt** einen Verdeckungspfad, statt einen zu schaffen: der Card-interne waagerechte Bildlauf ist weg, die Materialachse liegt nicht mehr außerhalb des sichtbaren Bereichs. Kein `position: fixed`/`sticky` in den geänderten Dateien außer den Regeln, die `kraefteuebersichtPrint.css` für den Druck ausdrücklich **neutralisiert**. Die stehende Kopfzeile der Tabelle stammt unverändert aus `KatalogTabelle` (LFH-330/B2) und ist dort geprüft. |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung in Karten, wo verglichen wird. | **erfüllt** | Alle vier Teile liegen bei `Datensicht`/`KatalogTabelle` und bleiben unangetastet: `form="tabelle"` in **jeder** Breite (gepinnt: „der Meldebild-Baum bleibt AUCH bei 390 px eine Tabelle", plus e2e-Nachweis der fixierten Kennungsspalte auf 390 px), Spaltenschalter mit Zähler aus B2. C3 ergänzt zwei Dinge, die das Kriterium direkt bedienen: das Blatt startet **aufgeklappt** (die Verdichtung, um derentwillen die Seite existiert, ist ohne Klick lesbar) und die **Zeile** ist das Aufklapp-Ziel. Zusätzlich für den **Druck**: `thead { display: table-header-group }` und `tr { break-inside: avoid }` — ab Blatt 2 waren die Zahlenspalten sonst unbeschriftet. |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar, „Speichern und nächsten anlegen" mit gehaltenem Kontext, Sammelliste mit Ändern/Entfernen je Zeile, Labels über dem Feld, volle Tastaturbedienung. | **nicht anwendbar** | Keine der Flächen erfasst Daten. Die Kräfteübersicht ist eine reine Lesefläche mit einer abgeleiteten Aktion (Lagebericht-Entwurf); die Verdichtungszeile zeigt Zahlen und einen Link. |

## Was dieses Ticket am Zustand geändert hat

Vier der fünf Befunde sind geschlossen, der fünfte in seinen prüfbaren Teilen:

- **H3** (gefilterte Kennzahlen ohne Hinweis) — Kopftitel schaltet um, „X von Y Kräften"
  steht immer, aktive Filter als schließbare Marken, ungefilterte Stärke als Bezugswert.
- **H4** (Ausdruck ohne Bezug) — `.kraefte-nur-print` mit Bezeichnung, Einsatznummer,
  taktischem Zeitstand, Ersteller und der Zeile „Auswahl: …".
- **H6** (12 Kennzahlen hinter Bildlauf) — Raster statt Reihe, im Browser gemessen.
- **H7** (startet zugeklappt) — aufgeklappt mit Einmal-Riegel, Umschalter, ganze Zeile
  als Ziel.
- **H21** (nicht verlinkt) — Verdichtungszeile mit Link auf allen vier Modulseiten.

## Offene Nachzüge

Was beim Umsetzen liegen geblieben ist. Formuliert so, dass daraus eigenständige Tickets
werden können.

1. **Das Schließkreuz eines `Tag closable` ist keine Dichte-Fläche.** antd zeichnet es in
   fester Größe; es hängt nicht am `ConfigProvider` und wächst in der Handschuh-Stufe
   nicht mit. In der Filterleiste der Kräfteübersicht ist das heute vertretbar, weil
   „Filter zurücksetzen" als vollwertiger Knopf danebensteht und dieselbe Wirkung für alle
   Filter auf einmal hat — die Marke ist die *feinere* Bedienung, nicht die einzige. Wird
   das Muster anderswo übernommen, wo es keinen solchen Zweitweg gibt, ist es ein echter
   Mangel. Ticket-Kandidat: entweder eine Projekt-Hülle um `Tag closable` mit
   dichteabhängiger Trefffläche, oder eine ausdrückliche Regel „Marken immer mit
   Sammel-Zurücksetzen daneben".

2. **Das Akzeptanzkriterium „`grep -rc 'kraefteuebersichtPfad' … = je 1`" ist wörtlich
   unerfüllbar.** `grep -c` zählt **Zeilen**; jede Seite, die den Builder benutzt, braucht
   eine Import-Zeile **und** eine Verwendungszeile — also mindestens 2. Gemessen steht
   jetzt in allen vier Seiten genau **eine Verwendung** (Import abgezogen), und es gibt 0
   Inline-Literale auf `/kraefteuebersicht` außerhalb von `deeplinks.ts`. Der **Sinn** des
   Kriteriums ist damit erfüllt, sein Wortlaut nicht. Für künftige Tickets: solche
   Kriterien als „genau eine Verwendungsstelle" formulieren, nicht als Zeilenzahl.

3. **Der Kontrastnachweis fehlt weiterhin für alle Statusrollen auf Kartengrund** (siehe
   Zeile 5). Das ist keine C3-Lücke, sondern dieselbe, die LFH-368/B5h für die
   Warnstufen-Füllungen offengelassen und auf den Playwright-Topf von LFH-370/B5j gezeigt
   hat — dieser Topf führt sie bis heute nicht.

4. **Die Zahl der Filter-Marken ist nach oben offen.** Vier Filter ergeben höchstens vier
   Marken, das passt. Käme ein fünfter oder sechster Filter dazu, umbricht die Zeile
   mehrfach und schiebt den Kopf nach unten — genau die Sorte Sprung, gegen die Kriterium
   12 existiert. Heute kein Problem, beim nächsten Filter mitzudenken.
