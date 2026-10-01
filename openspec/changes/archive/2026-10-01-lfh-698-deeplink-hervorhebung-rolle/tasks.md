# Tasks

## 1. Ist-Stand messen (vor dem Fix)

- [x] 1.1 Im Browser (Prod-Bundle wie `e2e/`) für beide Modi festhalten, welche Fläche die markierte Zelle heute wirklich trägt (normale und fixierte Kennungsspalte, Personaltabelle per `?personal=<id>` (statt der zuerst genannten Fahrzeugtabelle: die Personalseite lässt sich per API ohne Stammdaten säen), ETB-Zeile per `?eintrag=<id>`); Ergebnis als Absatz „Gemessen vor dem Fix“ in `design.md` unter Context. Verifikation: der Absatz nennt die gemessenen `rgb()`-Werte je Modus und Zelle.
- [x] 1.2 Prüfen, ob antds Fixkanten-Schatten an der Zelle oder an `::after` hängt und ob ETB-Karten ihre Statustönung (Berichtigung) inline oder per Klasse setzen; Befund in `design.md` (Risiken) nachziehen. Verifikation: beide Risiken tragen „geprüft: …“.

## 2. CSS-Farbgate (zuerst rot, dann grün)

- [x] 2.1 `ohneKommentare` aus `theme/gate5.guard.test.ts` in ein geteiltes Hilfsmodul `test/ohneKommentare.ts` ziehen (nicht kopieren; `test/` statt `theme/`, weil es Testwerkzeug ist und kein Rollenwert), gate5 darauf umstellen. Verifikation: `mise exec -- pnpm -C frontend test gate5` grün.
- [x] 2.2 `theme/cssFarbquelle.guard.test.ts` per TDD: Fälle Hex, `rgba()`, `hsl()`, Literal nur im Kommentar, `rollen.css` ausgenommen, Schuldeintrag ohne Literal macht rot, neue Datei mit Literal macht rot (die Scanner-Funktion rein und exportiert, an Texten geprüft). Schuldmenge `OFFEN = ['components/Markdown.css', 'components/MarkdownEditor.css']`. Verifikation: der Guard ist am unveränderten Baum ROT und nennt genau `index.css:14` und `index.css:20`.
- [x] 2.3 Mutationsprobe: ein `#000` in eine beliebige CSS-Datei außerhalb der Schuldmenge, ein Eintrag aus `OFFEN` gestrichen — beide Male rot; Proben zurückgenommen. Verifikation: Ausgabe beider Läufe im Lauf-Protokoll des PR.
- [x] 2.4 Nachzug „Markdown-CSS auf Rollen ziehen“ per `clickup-task-anlegen` anlegen und seine ID im Kommentar über `OFFEN` nennen. Verifikation: Kommentar trägt die `LFH-…`-Nummer.

## 3. Hervorhebung auf Rollen

- [x] 3.1 `e2e/deeplink-hervorhebung-kontrast.spec.ts` (Messkern `e2e/kontrast-kern.ts`, Böden als Literale Tag 7 / Nacht 5 / Linie 3) für beide Modi: Tabellenzeile mit fixierter Kennung per Deeplink, Kartenzweig auf 390 px, ETB-Zeile; misst Zellentext gegen komponierte Fläche, Linienfarbe (`box-shadow`) gegen Markierungs- und Nachbarfläche, Fläche ≠ Hover-Fläche einer Nachbarzeile, Linie bleibt unter dem Zeiger. Verifikation: Spec ist gegen den unveränderten Stand ROT (keine Linie).
- [x] 3.2 `index.css`: Regel auf `var(--lfh-bedien-flaeche)` + `box-shadow: inset 0 2px 0 var(--lfh-bedien), inset 0 -2px 0 var(--lfh-bedien)`, Selektoren wie `personen/betroffene.css` (über antds Sortierspalte, s. design.md E2), Nachtblock entfällt; Kopfkommentar nennt LFH-698 und die zwei Kanäle. Verifikation: Spec aus 3.1 grün in beiden Modi; Guard aus 2.2 grün; `grep -nE '#[0-9a-fA-F]{3,6}' frontend/src/index.css` ohne Treffer.
- [x] 3.3 Verweise nachziehen: Kommentare in `personen/betroffene.css` und `pages/kraefteuebersichtPrint.css`, die `.zeile-hervorgehoben > td` als Präzedenzfall nennen, auf die neue Form anpassen. Verifikation: `grep -rn "zeile-hervorgehoben > td" frontend/src` leer oder stimmig.
- [x] 3.4 `frontend/AGENTS.md`, Farbachsen: eine Zeile „Deeplink-Hervorhebung = `bedienFlaeche` + Ober-/Unterlinie `bedien` (LFH-698); Farbliterale in CSS nur in `theme/rollen.css` (`theme/cssFarbquelle.guard.test.ts`)“. Verifikation: `prettier --check frontend/AGENTS.md` grün.
- [x] 3.5 Screenshots beider Modi (Tabelle mit Hover auf Nachbarzeile, Karte) dem Menschen übergeben und im PR beschrieben (aus der Cloud-Sitzung lassen sich keine Bilder in den PR laden). Verifikation: vier Bilder in der Sitzung, Beschreibung im PR-Body.

- [x] 3.6 Review-Befunde: Infotelefon setzt die Fläche inline wie das ETB (Test zuerst rot in `InfotelefonPage.test.tsx`); Messkern prüft die Linienform (genau zwei `inset`-Linien oben/unten, kein Ring); e2e gleicht Fläche und Linie mit den Rollen-Properties ab (Tabelle, Karte, ETB) und prüft „unter dem Zeiger“ an jeder Zelle; Design, Spec-Geltung und Kommentare berichtigt; Nachzug LFH-896 für den Ring der Kommunikationskarten. Verifikation: Gegenproben Ring, nur Oberlinie und Linie in `alarmText` jeweils rot; e2e-Spec in beiden Modi grün.

## 4. Abschluss

- [x] 4.1 `./scripts/check-all.sh` grün (lokal; Kästchen verweist auf den CI-Lauf des PR). Lokal: Bündel `schnell` und `frontend` grün; `rust` passt nicht ins Plattenkontingent der Cloud-Sitzung (rund 100 Testbinaries, Abbruch mit „No space left on device“), die Änderung berührt kein Rust; `e2e` mit 12 roten Tests (`fokus-verdeckung`, `etb-anhang`, `schaden-anhaenge`, `gate3-trefflaeche` Führungsfunktionen), die mit `index.css` und `InfotelefonPage.tsx` aus `origin/alpha` identisch rot sind (Umgebung: Chromium 1194 statt 1234). Beleg für alle Bündel ist der CI-Lauf des PR.
- [x] 4.2 Prüfliste: Gate-Frage im ClickUp-Task beantwortet (gebaut, mit Schuldmenge), Farbverschiebung Gelb → Bedienblau als gewollte Korrektur in PR und Task benannt.
