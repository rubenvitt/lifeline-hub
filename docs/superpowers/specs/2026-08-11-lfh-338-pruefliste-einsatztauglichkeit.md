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
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **erfüllt** (LFH-515, 11.09.2026) | Im Browser gemessen, `e2e/gate3-trefflaeche.spec.ts` (zwei Tests am Dateiende, dieselben Helfer wie die drei Bestandsrouten). Messwerte über die Staffel: Umschalter-Hülle **30 / 48 / 72**, „Filter zurücksetzen" **30 / 48 / 72**, Filter-Suchfeld **30,1 / 48 / 72**. **Ein Befund, behoben:** der Kräfteübersicht-Link der Verdichtungszeile maß **15 / 16 / 16 px** — das einzige Bedienelement dieser Zeile, im Handschuh-Betrieb bei nicht einmal einem Viertel des Bodens. Genau der Fall, den CLAUDE.md seit LFH-396 als Regel führt („ein `<a>` erbt keine Steuerhöhe"), und genau die Annahme, die Kriterium 1 dieser Liste mit „alle neuen Bedienelemente sind echte antd-Steuerelemente und erben die Staffel" ungeprüft übernommen hatte — für `Segmented`, `Button type="link"` und `Input.Search` stimmt sie, für `Link` nicht. Behoben über `verdichtungsLinkStil` (zwei Angaben nach LFH-365), danach **35,5 / 48 / 72**. **Zwei gemessene Nachsichten, beide benannt:** das einzelne Segmented-Wahlfeld liegt mit **26 / 44 / 68** konstant 4 px unter der Hülle (antds `segmentedContainerPadding`, 2 px je Seite) — die Wahlfelder kacheln die Hülle lückenlos, und ein Wahlfeld auf 72 px zu zwingen machte die Hülle 76 px hoch und die Staffel selbst falsch; zugesichert sind deshalb Hülle **und** lückenlose Kachelung. Und die **Filter-Marke ist dichteblind** (22 px, Schließkreuz 10×10 px in *jeder* Stufe) — das ist die schon in Kriterium 1 benannte Ausnahme, jetzt gemessen statt behauptet; getragen wird sie allein vom Zweitweg „Filter zurücksetzen", und genau das sichert der Spec zu (steht eine Marke, muss der Knopf dastehen und den Boden halten). Mutationsprobe protokolliert im Spec-Kopf. |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **erfüllt** | Filtern, Aufklappen und der Umschalter sind reine Client-Operationen ohne Serverrunde. Die einzige Aktion mit Serverantwort ist „In Lagebericht übernehmen" — sie trägt unverändert `loading={uebernehmen.isPending}` am Knopf. Der Druckpfad wartet bewusst einen Render ab (`printPending`-Effekt), bevor `window.print()` läuft. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **nicht anwendbar** | Keine der Flächen führt eine kritische oder irreversible Aktion aus. „In Lagebericht übernehmen" legt einen **Entwurf** an, der vom EL löschbar ist (Kommentar an der Mutation); Filtern, Aufklappen und Drucken sind folgenlos. |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **gemessen (LFH-515, 11.09.2026); Nachtziel erfüllt, Tagziel verfehlt → LFH-538** (<https://app.clickup.com/t/123zgec2c0d>) | Der Nachweis ist gebaut und läuft: `e2e/kraefte-kontrast.spec.ts`, zwei Tests über beide Modi, gerechnet mit demselben Messkern wie LFH-446 (komponierte Grundfläche über alle Elternlagen, Alpha eingerechnet; sein Selbstbeweis steht im ersten Test derselben Datei). Gemessen wurden **zwei verschiedene Gründe**, und das ist der Punkt: die Kopf-Statuszahlen stehen auf Kartengrund, dieselben drei Rollen in der Verdichtungszeile auf Seitengrund. **Nachtmodus hält die 5 : 1** in allen sechs Werten (Kopf auf `rgb(22,28,37)`: 6,02 / 7,22 / 5,20 · Zeile auf `rgb(11,14,19)`: 6,80 / 8,16 / 5,87). **Hellmodus verfehlt die 7 : 1** in allen sechs (Kopf auf `rgb(255,255,255)`: 6,94 / 6,92 / 6,78 · Zeile auf `rgb(231,235,240)`: 5,80 / 5,78 / 5,66) — die absolute Untergrenze 4,5 : 1 ist überall gehalten. Der Fehlbetrag ist eine Eigenschaft der **Rollen-Tokens als Textfarbe**, nicht dieser Seiten: selbst auf reinem Weiß bleiben alle drei Rollen unter 7. Genau deshalb legt `StatusTag` (LFH-446) die Rolle auf den *Rand* und die Beschriftung in `token.colorText`; Kopfzahlen und Verdichtungszeile sind die zwei Flächen, die sie direkt auf den Text legen. Behoben wird das **nicht hier**: beide Wege (Tokens im Hellmodus abdunkeln — trifft jeden `rollenFarbe`-Konsumenten, auch Ränder, wo 3 : 1 genügt — oder die zwei Flächen auf die `StatusTag`-Bauform umstellen) sind Gestaltungsentscheidungen mit eigenem Ticket, kein Nebenprodukt eines Messungs-Nachzugs. Die Zusicherung steht deshalb im Hellmodus auf 4,5 und nennt den verfehlten Zielwert in jeder Meldung; im Nachtmodus steht sie hart auf 5. Mutationsprobe für **beide** Schranken getrennt protokolliert im Spec-Kopf. **Korrektur (05.09.2026):** eine frühere Fassung verwies diese Zeile auf LFH-396, das Kontrast nie erwähnte. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **erfüllt** | Die kompakten Statuszeilen tragen die Bedeutung im **Wortlaut**, die Farbe verstärkt nur: „1 frei · 0 gebunden · 0 n. einsatzbereit" im Kopf, „… frei / … gebunden / … n. verf." in der Verdichtungszeile. Vor dem Umbau standen dort vier `Statistic` mit Titel — die Aussage ist erhalten, nicht auf Farbe reduziert worden. Gepinnt in `KraefteuebersichtPage.test.tsx` („zeigt Fahrzeug-Verfügbarkeits-Achse im Kopf", prüft **Text**, nicht Farbe) und `Verdichtungszeile.test.tsx`. Auch das Materialband nennt je Statuszahl das Wort (`label.replace('Mtl. ', '')`). |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **erfüllt** | 0 Farbliterale (Beleg in Zeile 5). Die drei Fahrzeug-Rollen sind byte-gleich dieselben wie in der Statusspalte der Tabelle darunter (`statusKategorie.verfuegbar/gebunden/nicht_verfuegbar`) — die Kopfzahl und der Tag darunter können nicht in verschiedenen Tönen sprechen. Die Verdichtungszeile nutzt exakt dieselben drei Rollen; eine vierte Bedeutung ist nicht entstanden. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** | App-weite Lücke, bereits unter LFH-336/337 dokumentiert und dort gebündelt: kein Regler existiert irgendwo in der Anwendung. Nicht seitenspezifisch und nicht im Scope von C3. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **erfüllt** | Genau das ist der Kern von Befund H6: bis zu 12 Kennzahlen lagen in einer nicht umbrechenden Reihe hinter einem Bildlauf im Karteninneren, die komplette Materialachse damit **außerhalb** des Schirms. Jetzt drei Rasterspalten, die auf einem Führungs-Tablet ohne Bildlauf stehen — gemessen in `e2e/meldebild-tabelle.spec.ts` („Monitoring-Kopf … bricht um statt waagerecht zu scrollen"): Inhaltsbreite 678 px, Inhalt 678 px, alle drei Achsen `toBeInViewport`. Mutationsprobe protokolliert: mit den alten Angaben 999 px Inhalt in 678 px Fläche. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Keine der Flächen erzeugt Alarme. Die Kräfteübersicht hat keinen eigenen Live-Stream (sie importiert `useEinsatzLiveStream` nicht — Kommentar am Zufluss-Argument der Seite), die Verdichtungszeile ebenfalls nicht. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -rn "animation\|blink\|@keyframes"` über `KraefteuebersichtPage.tsx`, `Verdichtungszeile.tsx` und `kraefteuebersichtPrint.css` liefert **0 Treffer** — kein Blinken, keine Bewegung, kein Ton. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt** | Drei bewusste Entscheidungen tragen das. **(a)** Das automatische Aufklappen greift **genau einmal** (`initialAufgeklappt`-Riegel): ohne ihn klappte jeder Neuaufbau des Baums — und `bild` hängt an sechs Queries **und** am Filter, jeder Tastendruck im Suchfeld baut ihn neu — die Handarbeit der Einsatzkraft wieder auf. Gepinnt: „klappt eine vom Benutzer zugeklappte Zeile NICHT bei jedem Datenzufluss wieder auf". **(b)** Die Verdichtungszeile verschwindet nicht wieder, sobald sie einmal steht: der Datenriegel steht vor der Fehlerprüfung, ein gescheiterter FOLGEabruf lässt die Zahlen also stehen (Test „lässt die zuletzt bekannten Zahlen stehen, wenn erst der ZWEITE Abruf scheitert"). **Offen bleibt der Erstaufbau:** vor dem ersten Ladeergebnis rendert sie `null` und schiebt die Tabelle beim Erscheinen um eine Zeile nach unten. Ein erster Entwurf dieser Zeile führte das als Vorzug — das ist falsch herum: eine Höhenreservierung verschöbe nichts, ihr Fehlen tut es. Die Verschiebung wird **akzeptiert**, weil sie einmalig vor der ersten Interaktion liegt und die Zeile zum Kopf der Seite gehört, nicht zur Tabelle; ein Platzhalter fester Höhe ist der Nachzug, falls sie im Betrieb auffällt (Nachzug 4). **(c)** Die Wahrheitszeile im Kopf steht **immer**, auch ungefiltert: erschiene sie erst bei gesetztem Filter, wäre ihr Erscheinen selbst ein Sprung. Der `zufluss="sofort"`-Vertrag des Meldebilds bleibt unverändert und ist an seiner Fundstelle begründet (die Schleuse führt nur die Wurzel-Schlüsselfolge, eine neue Disposition landet tief im Baum). |
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
   nicht mit. **Seit LFH-515 ist das gemessen statt vermutet** (`e2e/gate3-trefflaeche.spec.ts`):
   die Marke misst **22 px** und ihr Schließkreuz **10 × 10 px** — in *jeder* der drei
   Dichtestufen, während „Filter zurücksetzen" daneben 30 / 48 / 72 hält. Der Spec sichert
   deshalb den Zweitweg zu (steht mindestens eine Marke, muss der Knopf dastehen und den
   Boden halten) und protokolliert die Maße der Marke, statt sie zu pinnen: sie sind
   antd-Bestand, und ein Pin auf 22 bräche bei einem antd-Sprung, ohne dass jemand etwas
   falsch gemacht hätte. In der Filterleiste der Kräfteübersicht ist das vertretbar, weil
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

3. **Der Kontrastnachweis ist mit LFH-515 erbracht — und hat einen Befund geliefert**
   (siehe Zeile 5). Gemessen auf Karten- *und* Seitengrund in beiden Modi: der Nachtmodus
   hält seine 5 : 1, der Hellmodus verfehlt seine 7 : 1 in allen sechs Werten (schlechtester
   5,66 : 1 auf Seitengrund), die absolute Untergrenze 4,5 : 1 hält überall. Ursache sind die
   Rollen-Tokens **als Textfarbe** — auf reinem Weiß bleiben alle drei Rollen unter 7 —, nicht
   diese beiden Flächen. Der Fix ist eine Gestaltungsentscheidung mit Breitenwirkung und liegt
   als **LFH-538**. Die Warnstufen-Füllungen aus LFH-368/B5h bleiben davon unberührt: sie
   zeigen weiterhin auf den Playwright-Topf von LFH-370/B5j, der sie bis heute nicht führt.

4. **Der Erstaufbau der Verdichtungszeile verschiebt die Tabelle um eine Zeile.** Sie
   rendert `null`, bis beide Listen da sind, und schiebt beim Erscheinen alles darunter nach
   unten. Einmalig und vor der ersten Interaktion, deshalb akzeptiert — ein Platzhalter mit
   `minHeight` in Zeilenhöhe wäre der Fix, kostet aber auf einer Seite ohne Zahlen eine leere
   Zeile. Ticket-Kandidat, falls es im Betrieb auffällt.

5. **Die Zahl der Filter-Marken ist nach oben offen.** Vier Filter ergeben höchstens vier
   Marken, das passt. Käme ein fünfter oder sechster Filter dazu, umbricht die Zeile
   mehrfach und schiebt den Kopf nach unten — genau die Sorte Sprung, gegen die Kriterium
   12 existiert. Heute kein Problem, beim nächsten Filter mitzudenken.
