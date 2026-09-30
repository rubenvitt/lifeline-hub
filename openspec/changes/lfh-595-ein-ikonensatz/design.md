# Design

## Context

Warum die Änderung nötig ist, steht in proposal.md. Hier nur der Bestand, der den Weg bestimmt:

- **72 Quelldateien und 3 Testdateien** importieren Ikonen aus `@ant-design/icons` oder
  `react-icons`. Am stärksten betroffen sind `components/` (13), `pages/` (13),
  `pages/lagekarte/` (9), `etb/` und `einsatz/` (je 5) sowie `command-palette/` (4).
- **`IconType` aus `react-icons` ist ein Datenvertrag:** `einsatz/modulRegistry.ts` (Kategorien
  und Module), `command-palette/typen.ts` (`Befehl.icon`), `befehle.ts`, `BenutzerMenu.tsx`,
  `theme/darstellungOptionen.ts` und `pages/gefahren/GefahrenMatrix.tsx` reichen Ikonen als
  Komponente weiter.
- **Die Rail** (`einsatz/IconRail.tsx`) zeichnet `<Icon size={20} />` in einer
  `aria-hidden`-Hülle, den Namen trägt der Knopf. Aktiv wird bisher über Fläche und Farbe gezeigt.
- **Die Ikonen von antd** (`<span role="img" class="anticon">`, `1em`, `currentColor`) wachsen
  mit der Schrift und damit mit der Dichte. Zwei Tests fragen die Klasse ab:
  `kraefte/AmpelZelle.test.tsx` (`.anticon svg`) und `einsatz/ModulPanel.test.tsx`
  (`.anticon-lock`).
- **Emojis als Ikone:** `wetterIcon()` und das NINA-⚠️ in
  `pages/lagekarte/FachebenenInspector.tsx`, ☎ in `components/FunkErreichbarkeit.tsx`, 🚧 in
  `components/Platzhalter.tsx`. Laut Dateikopf hängen `App.test.tsx` und
  `einsatz/ModulStub.test.tsx` am 🚧. ✓ steht nur im Wortlaut von Chips und Menüs.
- **`AnsichtSwitcher.tsx`** färbt den Standardstern fest mit `#faad14`. Das verstößt gegen
  „Farbwerte nur aus `theme/tokens.ts`“.
- **Muster für erzeugte Grafik:** `scripts/marke/` (Quellen, Erzeugungsskript, Stempel
  `quellen.sha256`) mit dem Guard `marke/marke.guard.test.ts`.
- **Icons8:** Die iOS-Stile sind auf ein 50-px-Raster gezeichnet (Nenngröße 50). Ob die SVGs
  Konturen als Füllfläche oder als Strich enthalten, ist ungeprüft: Der SVG-Abruf ist erst mit
  dem Abo möglich (heute „account does not have MCP API access“).

## Goals / Non-Goals

**Goals:**

- Eine Komponente je Ikone, die sich wie heute eine antd-Ikone verhält (`1em`, `currentColor`,
  wächst mit der Dichte), damit Aufrufer nur den Import tauschen.
- Die Quellen liegen nachvollziehbar im Repo (Icons8-Kennung, Stil, Begriff, Ersatz- oder
  Eigenvermerk), sodass jede Ikone ohne Icons8-Zugang neu erzeugt werden kann.
- Ein Guard, der den Bestand sichtbar abträgt und am Ende neue Fremdimporte und Emojis verhindert.

**Non-Goals:**

- Die Ikonen, die antd in seinen eigenen Bauteilen zeichnet, bleiben (siehe D7).
- Taktische Zeichen, Bildmarke, Karten-Marker der Lagekarte und das Liniendiagramm
  `wetter/Verlaufslinie.tsx` sind keine Ikonen und bleiben unberührt.
- Keine neue Ikone für einen Begriff, den die Oberfläche heute nicht zeigt. Fehlende
  Fachikonen (Stromerzeuger, Sandsack, Polizeifahrzeug) entstehen erst, wenn eine Seite sie
  braucht, dann nach der Lückenregel.
- Kein Umbau von Bedienlogik. Wo eine Ikone heute steht, steht danach die entsprechende Ikone
  des Satzes.

## Decisions

**D1 Stil: iOS 27 Outlined, Zwilling iOS 27 Filled (Entscheidung Ruben, 30.09.2026).**
Er ist mit 11.181 Ikonen der größte einfarbige Stil bei Icons8 und hat als einziger einen
deckungsgleichen gefüllten Zwilling (gleiche Begriffe, gleiche Namen). Beim Abgleich deckte er
87 von 90 UI-Begriffen exakt ab und 21 von 30 Fachbegriffen.
*Verworfen:* Tabler bleibt (dort fehlen Trage, Sirene und Funkgerät, und es gibt nur ein
Gewicht). Windows 11 Outline/Filled (dort fehlen Trage, Biogefährdung und Wasserpumpe).
Material (12 von 30 Fachbegriffen). *Plan B,* falls die Stilprobe (D8) durchfällt: Windows 11
Outline/Filled, sonst eine Suche außerhalb von Icons8. Das entscheidet Ruben.

**D2 Ablage: Quellen unter `scripts/ikonen/`, Erzeugtes unter `frontend/src/ikonen/`.**
- `scripts/ikonen/ikonen.json` ist das Register: `lizenz` (Grundlage der Ablage) und je Eintrag
  ein deutscher Name (Bildinhalt, nicht Verwendung, also `karte` statt `lage`), Bedeutung in der
  App, Icons8-Kennung und -Name, optional der gefüllte Zwilling und die Herkunft (`icons8` |
  `ersatz` | `eigen`).
- `scripts/ikonen/quellen/<name>.svg` bzw. `<name>.gefuellt.svg` sind die eingecheckten
  Originale. Eigene Zeichnungen liegen im selben Ordner und tragen einen Vermerk im Kopf.
- `scripts/ikonen/erzeuge-ikonen.mjs` erzeugt daraus `frontend/src/ikonen/erzeugt.generated.ts`
  (Prettier-formatiert, also ohne Ausnahme in `.prettierignore`).
- `scripts/ikonen/quellen.sha256` ist der Stempel über Register, Quellen und Ausgabe.
- Neue Ikonen holt der Agent über den Icons8-MCP (Konto mit Abo) als SVG nach `quellen/`.
  Das Skript selbst geht nicht ins Netz. *Geändert 30.09.2026:* Ein eigenes Abrufskript mit
  persönlichem Schlüssel entfällt. Es wäre ohne Schlüssel in der Sitzung nicht prüfbar, und die
  eingecheckten Quellen machen den Betrieb ohnehin unabhängig vom Icons8-Zugang.
- `scripts/ikonen/vergleiche-png.mjs` prüft jede Quelle gegen das PNG, das Icons8 frei und
  byte-genau ausliefert (Rendern in Chromium, Vergleich der Deckkraft). Der MCP liefert das SVG
  als Text in die Sitzung, abgelegt wird es durch Abschreiben, und ein vertauschtes Zeichen in
  den Pfaddaten bliebe sonst unsichtbar. Die Gegenprobe (eine Koordinate um 6 verschoben) schlägt
  an.

*Verworfen:* SVGs zur Laufzeit von `img.icons8.com` laden (bricht offline und im Fükw ohne
Netz), SVGR als neue Abhängigkeit (das Umformen ist eine Handvoll Zeilen Node ohne Paket).

**D3 Eine Komponente je Ikone, gemeinsamer Rahmen.**
`erzeugt.generated.ts` exportiert je Registereintrag eine benannte Komponente (`IkoneTrage`,
`IkoneKarte`, `IkoneKarteGefuellt`), alle über einen gemeinsamen Rahmen `IkonenRahmen`
(`frontend/src/ikonen/IkonenRahmen.tsx`):
- Vorgabegröße `1em`, `fill="currentColor"`, `aria-hidden`, `focusable="false"`.
- Die Hülle ist `<span class="anticon lfh-ikone" data-ikone="<name>">`. Die Klasse `anticon`
  ist Absicht: antd richtet Ikonen in Knöpfen, Menüs, Tags und Eingaben über genau diese Klasse
  aus. Die Grundausrichtung (`resetIcon` aus `antd/es/style`) steht zusätzlich inline, weil antd
  die globale Regel erst mit seiner ersten eigenen Ikone einspeist. Tests finden eine Ikone über
  `data-ikone`.
- Eine Prop `size` für feste Maße (Rail 20 px).

Der Typ `Ikone` (`ComponentType<IkonenProps>`) ersetzt `IconType`. Der Einstieg ist
`frontend/src/ikonen/index.ts`. Das Register enthält nur Ikonen, die der Code verwendet (Guard,
D6), deshalb spielt Tree-Shaking keine Rolle.
*Verworfen:* eine generische `<Ikone name="trage" />` (Tippfehler erst zur Laufzeit, der
Datenvertrag der Registry bliebe ein String).

**D4 Aktiver Zustand über ein Paar.**
Wo aktiv/inaktiv unterschieden wird, trägt der Datensatz das Paar
(`{ umriss: Ikone; gefuellt: Ikone }`, Typ `IkonenPaar`). Die Rail wählt nach `aktiv`, Fläche
und Farbe bleiben. Der Standardstern in `AnsichtSwitcher.tsx` wird zur gefüllten Ikone in der
Textfarbe, das feste `#faad14` entfällt (die Füllung ist jetzt der Kanal).

**D5 Barrierefreiheit bleibt am Bedienelement.**
Die Ikone ist immer `aria-hidden`. Den Namen trägt der Knopf oder das Wort daneben, wie heute
in Rail, Dropdown-Auslösern und `Datensicht`. Tests, die eine Ikone über ihr antd-`aria-label`
finden, werden auf den Namen des Bedienelements umgestellt, nicht auf die neue Klasse.

**D6 Ein Guard, drei Prüfungen: `frontend/src/ikonen/ikonen.guard.test.ts`.**
1. *Kein Fremdimport:* Kein `.ts`/`.tsx` außerhalb von `ikonen/` importiert aus
   `@ant-design/icons` oder `react-icons`. Die Schuldmenge `OFFEN` (Dateiliste) schrumpft nur,
   ein Eintrag ohne Fund macht den Guard rot (Muster `dichte.guard.test.ts`).
2. *Register, Quellen, Erzeugtes und Stempel stimmen überein.* Außerdem ist jeder
   Registereintrag im Code verwendet (keine toten Ikonen), und jede `eigen`-Quelle trägt den
   Vermerk in ihrem Kopf.
3. *Kein Emoji im Code:* `\p{Extended_Pictographic}` in `.ts`/`.tsx` außerhalb von Kommentaren
   und Testdateien. Erlaubt sind ↗ und ↔, dazu ⧖ und ✓, die ohnehin nicht als Bildzeichen
   zählen. Der Emoji-Teil wird erst scharf, wenn die Emojis abgetragen sind (D9), bis dahin mit
   eigener Schuldmenge.

*Verworfen:* eine ESLint-Regel `no-restricted-imports`. Lint läuft mit `--max-warnings 0`, eine
rot geborene Regel würde abgeschaltet (CLAUDE.md, Qualitäts-Gates). Nach dem Abtrag bleibt der
Guard, und das Entfernen der Pakete aus `package.json` (pnpm, strikt) sperrt den Import ein
zweites Mal.

**D7 antd-interne Ikonen bleiben.**
antd bringt `@ant-design/icons` als eigene Abhängigkeit mit und zeichnet damit Select-Pfeile,
Schließkreuze, Sortierpfeile und den Spinner von `loading`. Diese über `ConfigProvider` oder
Einzel-Props zu ersetzen, wäre ein Eingriff in jede antd-Komponente und bringt keinen Gewinn für
die Formensprache. Die Spec nimmt sie ausdrücklich aus. Wo der Code selbst ein Ikon an ein
antd-Bauteil gibt (`icon={…}`, `suffixIcon`, `expandIcon`), kommt es aus dem Satz.
`LoadingOutlined spin` in `karten/OfflineKartenVerwaltung.tsx` wird zu einer Ladeikone des
Satzes mit eigener Drehung (CSS `@keyframes`, abgeschaltet unter
`prefers-reduced-motion`).

**D8 Stilprobe als erster Schnitt, mit Freigabe.**
Die Probe stellt echte Stellen um: Rail (Paar), Kopfleiste, ein Zeilen-Aktionsmenü und einen
Seitenkopf. Dazu gibt es Aufnahmen per Playwright bei 390, 1024 und 1440 px, bei Tag und Nacht
und in den Dichten 30/48/72. Geprüft werden die Erkennbarkeit bei 16 und 20 px, die Kontur
bei dünner Linie auf dunklem Grund und die Ausrichtung in Knöpfen. Ruben gibt frei oder zieht
Plan B (D1). Ohne Freigabe wird nicht weiter umgestellt.

*Entscheidung Ruben, 30.09.2026: iOS 27 bleibt.* Grundlage waren die Aufnahmen und der
Vergleichsbogen bisher ↔ iOS 27 ↔ Windows 11 (`stilprobe/`). Die dünnen Linien (0,8 px bei
20 px) sind damit angenommen. Korrigiert wird innerhalb des Stils:
- Die Chevrons nehmen die einfachen Striche `expand-arrow`, `collapse-arrow` und `forward` statt
  der umrandeten `chevron-*`.
- Die Verbindungsanzeige nimmt das Paar `wi-fi-connected`/`wi-fi-disconnected` (Haken bzw.
  Kreuz), weil `no-connection` nur leere Balken ohne Durchstreichung zeigt.
- Die drei Punkte bleiben Ringe, eine gefüllte Fassung gibt es im Outlined-Stil nicht.

**D9 Emojis werden Ikonen oder Kurzwort.**
- `wetterIcon()` liefert eine Ikone statt eines Zeichens (Gewitter, Regen, Wind, Schnee, Nebel,
  Thermometer, Sonne, Warnung). Der Titel des Inspektors wird `ReactNode`.
- NINA bekommt die Warnikone.
- ☎ wird zur Telefonikone im `Tag`.
- 🚧 wird zur Ikone „Baustelle“ oder entfällt. Die Abfragen in `App.test.tsx` und
  `ModulStub.test.tsx` wechseln im selben Commit auf `title`/Klasse (Dateikopf von
  `Platzhalter.tsx`).
- ✓ im Wortlaut bleibt (Spec).

**D10 Lücken im heutigen Bestand.**
Von den Lücken des Abgleichs zeigt die Oberfläche heute nur zwei Begriffe:
- *Notunterkunft* (`TbHomeHeart`, Modul Betreuung): wird eine eigene Zeichnung.
- *Sitemap* (`TbSitemap`): Ersatz „Hierarchy“ aus demselben Stil.

`MinusCircleOutlined` (Akkordeon, Abschnitt leer) bekommt das passendste Kreissymbol des
Stils, festgelegt in der Zuordnungstabelle (Aufgabe 4). Alle anderen Lücken bleiben
ungezeichnet, bis eine Seite sie braucht.

## Risks / Trade-offs

- [Die 50-px-Linien werden bei 16–20 px dünn und auf dunklem Grund schwach] → Die Stilprobe
  (D8) prüft das, bevor mehr umgestellt wird. Plan B ist benannt.
- [Das Abo läuft aus oder die Lizenz verbietet die Ablage doch] → Die Lizenzgrundlage wird vor
  dem ersten Commit von SVGs am Lizenztext geprüft und im Register-Kopf vermerkt. Die Quellen
  liegen im Repo, der Betrieb hängt nicht am Icons8-Zugang.
- [Der SVG-Abruf ist auf 100 je Stunde begrenzt] → Rund 130 Ikonen (Umriss und die nötigen
  Gefüllten) passen in zwei Stundenfenster. Das Abrufskript arbeitet fortsetzbar.
- [Leicht andere Ausrichtung in Knöpfen als bei `anticon`] → Der Rahmen übernimmt antds
  Ausrichtung (D3). Gate 3 (`e2e/gate3-trefflaeche.spec.ts`) und die Probe-Aufnahmen prüfen es.
- [Große Diff-Fläche über 72 Dateien] → Die Umstellung geht bereichsweise (Aufgaben 5–8), und
  jeder Schritt trägt `OFFEN` ab. Zwischenstände sind grün, weil beide Welten koexistieren, bis
  die Schuldmenge leer ist.
- [Der Emoji-Scan ist heuristisch (Kommentare erkennen)] → Er arbeitet auf demselben
  Tokenizer-Ansatz wie die bestehenden Guards und listet in seinem Dateikopf, was er nicht
  sieht.

## Migration Plan

Alles läuft in einem Branch. `@ant-design/icons` und `react-icons` bleiben installiert, bis
`OFFEN` leer ist, und werden dann im letzten Schritt entfernt. Rückweg ist der Revert des
Branches. Daten, API und Server sind nicht betroffen.

## Open Questions

(keine offen)

- *Geklärt 30.09.2026:* Die SVGs von iOS 27 Outlined sind Füllflächen, kein Strich (`viewBox
  0 0 50 50`, ein `<path>`, Konturen 2 Einheiten breit). Das Erzeugungsskript setzt deshalb
  `fill="currentColor"` am `<svg>`. Bei 20 px ist eine Kontur 0,8 px breit, bei 16 px 0,64 px.
  Genau das prüft die Stilprobe (D8).
