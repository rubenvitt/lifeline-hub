# Design

## Context

Siehe proposal.md, „Why“. Stand im Code:

- `frontend/playwright.config.ts` kennt ein Projekt (`chromium`). Die Suite startet Backend und
  Vite selbst und teilt sich EINE Temp-DB über alle Worker.
- `e2e/druck-fluss.spec.ts` prüft die Mechanik unter `emulateMedia({ media: 'print' })` per
  `getComputedStyle` und zählt die Seiten des PDF aus `page.pdf()` am Rohtext
  (`/Type /Page`). Den PDF-Text liest der Spec nicht. `e2e/etb-druck.spec.ts` sät über 500
  Einträge und prüft Kopf, Ordnung und Druckbild. Ein PDF erzeugt er nicht.
- `druck/druck.css` setzt die Seitenzählung als Randfeld `@page { @bottom-right { … } }`.
  Nur Chromium zeichnet Randfelder (D3 der archivierten Change `lfh-22-druck-export`).
- Das Logo hängt an der Organisation, und davon gibt es im System genau eine:
  `POST /api/organisation/logo` (Multipart `datei`, PNG/JPEG ≤ 1 MiB, Virenscan; im e2e-Backend
  ohne `--clamav-addr`, also ein No-op). Kein e2e-Spec lädt bisher ein Logo hoch, und keiner
  sichert zu, dass keines da ist.
- CI (`.github/workflows/ci.yml`): vier e2e-Shards `e2e 1/4` … `e2e 4/4`, deren Namen im
  Ruleset 17017911 als Required Checks gepinnt sind. Jeder Shard installiert nur Chromium
  (`playwright install --with-deps chromium`) und ruft `check-all.sh --nur e2e` mit
  `PW_SHARD`. `berichte` erwartet genau vier Playwright-Blobs, `release.needs` nennt alle
  Prüfjobs.
- In dieser Cloud-Umgebung liegt nur Chromium unter `/opt/pw-browsers`. Firefox und WebKit
  fehlen lokal.

## Goals / Non-Goals

**Goals:**

- Jede Aussage zur Druckmechanik, die `druck-fluss` und `etb-druck` heute in Chromium treffen,
  gilt auch unter Firefox und WebKit, ausgenommen die PDF-Schritte.
- Seitenzählung und Logo sind am PDF belegt, und eine Mutationsprobe macht jeden der beiden
  Fälle rot.
- Der kritische Pfad der CI wird nicht länger, und keiner der gepinnten Check-Namen ändert sich.

**Non-Goals:**

- Den echten Seitenumbruch in Firefox und Safari automatisch zu beweisen. `emulateMedia` setzt
  die Druck-Media-Queries, fragmentiert aber nicht in Seiten. Nur `page.pdf()` tut das, und das
  gibt es nur in Chromium. Was Firefox und WebKit hier belegen, ist ihre Kaskade unter
  Druckmedium (`:has()`, komplexe `:not()`, `position`, `display`). Genau daran hing der
  Abschneidefehler: ein absolut positionierter Druckbereich. Ob das Blatt umbricht, zeigt in
  Firefox und Safari weiter nur die Handprüfung.
- Safari selbst. Playwrights WebKit ist ein eigener Build (unter Linux in der CI). Er teilt
  die Engine mit Safari, nicht aber dessen Druckpfad.
- Weitere Druck-Specs (`meldebild-tabelle`, `funkplan`) in die neuen Projekte aufzunehmen. Das
  Ticket beschränkt auf `druck-fluss` und `etb-druck`. Eine Erweiterung kostet nur einen
  Eintrag in `testMatch`.
- Am Anwendungscode etwas zu ändern.

## Decisions

### D1 — Firefox und WebKit in einem eigenen CI-Job, nicht in den Shards

Ein neuer Job `e2e Druck Firefox/WebKit` (`needs: binaer`) läuft parallel zu den vier Shards.
Er installiert nur `firefox webkit` (`--with-deps`) und ruft
`check-all.sh --nur e2e` mit `PW_PROJEKTE=firefox,webkit`. Die Shards setzen
`PW_PROJEKTE=chromium`. `release.needs` bekommt den neuen Job, und `berichte` lädt dessen
Blob mit und zählt fünf statt vier.

Warum: In die Shards gemischt, verteilt Playwright die Firefox- und WebKit-Fälle nach
Testzahl auf irgendeinen Shard. Welcher das ist, steht vorher nicht fest. Deshalb müsste
**jeder** der vier Shards beide Browser samt Systempaketen installieren. Die apt-Pakete für
WebKit liegen in keinem Cache, und das verlängert den kritischen Pfad aller vier Shards. Der
eigene Job zahlt die Installation einmal und auf einem Nebenpfad.

Preis: Der neue Check-Name ist nicht required, bis ein Mensch ihn im Ruleset 17017911
einträgt. Bis dahin sperrt ein roter Firefox/WebKit-Lauf keinen PR, wohl aber den Release
(`release.needs`). Diesen Handgriff kann kein Agent ausführen. Er steht als offene Aufgabe in
tasks.md (Gruppe 6) und in der Abschlussmeldung.

*Verworfen:*

- **In die bestehenden Shards (alle Projekte, `--shard` verteilt):** sofort required und ohne
  Ruleset-Handgriff, aber die Browser-Installation landet auf dem kritischen Pfad jedes Shards
  (s. o.). Ist dir der Ruleset-Handgriff wichtiger als die Laufzeit, ist das die Alternative.
  Sie kostet in tasks.md nur Gruppe 5.
- **Nächtlicher Lauf (`schedule`):** verschiebt den Befund vom PR auf den nächsten Morgen und
  sperrt weder Merge noch Release.
- **Shard-Zahl erhöhen (5/5 mit einem Browser-Shard):** ändert alle gepinnten Check-Namen
  (Kommentar in `ci.yml`). Jeder PR hinge auf „Expected“, bis das Ruleset nachzieht.

### D2 — `PW_PROJEKTE` in `check-all.sh`, Vorgabe alle Projekte

Schritt 7 reicht `PW_PROJEKTE` als `--project=<name>` je Eintrag an `playwright test` weiter.
Ohne Variable laufen alle Projekte, damit ein lokaler Vollauf dasselbe prüft wie die CI in
Summe. Vor dem Lauf prüft Schritt 7, ob die Browser der gewählten Projekte installiert sind.
Dazu fragt er Playwright nach dem Pfad der ausführbaren Datei
(`chromium|firefox|webkit.executablePath()`). Fehlt einer, bricht der Schritt mit der
Anweisung `pnpm -C frontend exec playwright install firefox webkit` ab, statt dass jeder
Testfall einzeln an „Executable doesn't exist“ scheitert.

*Verworfen:* Firefox/WebKit lokal stillschweigend überspringen, wenn sie fehlen. Dann gäbe das
Gate je Maschine eine andere Antwort, und `scripts/check-deps.sh` zieht genau diese Linie:
„ein falsch-grünes Gate ist schlechter als keines“.

### D3 — Projekte über `testMatch`, PDF-Schritte über den Browsernamen

`playwright.config.ts` bekommt `firefox` (`devices['Desktop Firefox']`) und `webkit`
(`devices['Desktop Safari']`), beide mit `testMatch: /(druck-fluss|etb-druck)\.spec\.ts$/`.
Die Liste steht EINMAL als Konstante mit Begründung. Im Spec bleiben die
Bildschirm- und Druckmedium-Schritte für alle Engines gleich. Was `page.pdf()` braucht, läuft
nur bei `browserName === 'chromium'`. Ein übersprungener PDF-Schritt hinterlässt eine
Annotation (`typ: 'nur-chromium'`), damit der Bericht ihn nicht als bestanden ausweist. Der
Zähler-Selbsttest wird außerhalb von Chromium per `test.skip` mit Grund übersprungen.

*Verworfen:* eigene Spec-Dateien für Firefox und WebKit. Das verdoppelte die Seeding- und
Prüfhelfer, und die Fassungen liefen auseinander.

### D4 — PDF-Text mit `pdfjs-dist` (devDependency)

Ein neues Modul `e2e/pdf-kern.ts` lädt das PDF aus `page.pdf()` mit dem Legacy-Build von
`pdfjs-dist` (`pdfjs-dist/legacy/build/pdf.mjs`, ohne Canvas, in Node). Es liefert je Seite
den Text (`getTextContent`, die Einträge einer Seite zusammengefügt und Leerraum normalisiert)
und die gezeichneten Bilder mit Breite und Höhe (`getOperatorList`, `paintImageXObject` samt
`page.objs`). Ein Selbsttest erzeugt mit `page.setContent` ein zweiseitiges Dokument mit
bekanntem Text und prüft den Auszug. Er hält das Werkzeug ehrlich, so wie der bestehende
Zähler-Selbsttest die Seitenzählung.

Die Zusicherung zur Seitenzählung: Für jede Seite i (1 … m) trägt der Text `Seite i von m`,
und m ist die Seitenzahl, die pdf.js meldet. Die bisherige Zählung am Rohtext bleibt als
unabhängige zweite Quelle stehen und muss dasselbe m ergeben.

*Verworfen:*

- **Eigener Parser mit `node:zlib`:** FlateDecode-Ströme entpacken, dann die Glyphen über die
  ToUnicode-CMap der subsetted Type0-Schriften zurück auf Text abbilden. Das kommt ohne neue
  Abhängigkeit aus, ist aber ein PDF-Parser im Testcode. Er bricht still, sobald Skia die
  Schriftausgabe ändert.
- **Bildvergleich des Kopfes (`toHaveScreenshot`):** Das Randfeld existiert nur im PDF, nicht im
  Screenshot. Für die Seitenzählung trägt das also gar nicht. Für das Logo brächte es
  Referenzbilder je Schriftstand und Maschine mit sich, und diese Pflege lohnt die Aussage nicht.
- **PDF rastern (pdf.js mit Canvas oder `pdftoppm`):** Das braucht native Abhängigkeiten oder
  Systemwerkzeuge im Shard, nur um am Ende wieder Text oder Bilder zu vergleichen.

`pdfjs-dist` muss durch `scripts/check-deps.sh` (GHSA-Audit, Schwelle `high`). Die
bekannte Lücke CVE-2024-4367 betrifft Versionen < 4.2.67 und das Rendern im Browser. Gepinnt
wird eine aktuelle 5.x. Das Paket landet nicht im Bundle, weil nur `e2e/` es importiert, und
ein Prüfschritt in Gruppe 1 belegt das am Prod-Build.

### D5 — Logo-Fall: eigenes PNG mit unverwechselbaren Abmessungen

Ein neuer Fall in `druck-fluss.spec.ts` lädt ein im Test erzeugtes PNG mit ungewöhnlichen
Abmessungen hoch (z. B. 97 × 41 px; per `node:zlib` gebaut, keine Fixture-Datei). Danach druckt
er einen mehrseitigen, freigegebenen Lagebericht ohne eigene Bilder:

- **alle Engines (Druckmedium):** Im Druckkopf (`[data-lfh="druckkopf"]`) steht ein `img` mit
  `complete`, `naturalWidth × naturalHeight` = 97 × 41, und es hat eine Fläche
  (`getClientRects`), ist also nicht `display: none`.
- **Chromium (PDF):** Seite 1 zeichnet mindestens ein Bild mit 97 × 41, die Folgeseiten
  zeichnen keines.

Vor `page.pdf()` wartet der Fall darauf, dass der Druckknopf bereit ist. Das ist dieselbe
Bedingung, unter der `useDrucken` druckt: Organisation und Logo sind geladen.

Die Organisation ist global. Das Logo bleibt deshalb nach dem Fall stehen und wird nicht
wieder gelöscht. Ein Löschen könnte einem parallel laufenden Logo-Fall derselben Suite (ein
anderes Projekt im lokalen Vollauf) das Bild unter dem Druck wegziehen. Das Hochladen
derselben Bytes ist ein Upsert und damit idempotent. Kein anderer Spec sichert zu, dass kein
Logo da ist (geprüft per Suche). Kommt so ein Spec hinzu, muss er das Logo selbst entfernen und
darf nicht parallel zu diesem Fall laufen.

*Verworfen:* die Abmessungen im PDF nicht zu prüfen, nur „irgendein Bild auf Seite 1“. Das
bliebe grün, falls ein anderes Bild in den Kopf rutscht. Erweist sich, dass Skia das Bild
umrechnet (andere Pixelmaße als das Original), weicht der Fall auf das Seitenverhältnis aus,
und design.md wird nachgezogen.

### D6 — Prüfliste: Browser-Verdikt im Bestand umschreiben, Belege hier

Die LFH-22-Prüfliste (`docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md`) verlangt selbst,
dass ihre Zellen mit dem Beleg umgeschrieben werden („offen → … automatisiert in LFH-729“).
`docs/superpowers/` ist eingefrorenes Archiv in dem Sinn, dass dort nichts Neues entsteht und
nichts nach OpenSpec wandert. Ein Verdikt nachzutragen, das die Datei selbst ankündigt, ist
deshalb erlaubt. Die Zellen bekommen das neue Verdikt in Kurzform. Für Firefox und WebKit lautet
es „erfüllt für die Mechanik (Engine-Kaskade, e2e); Blatt per Hand“. Die ausführlichen Belege
(Messwerte, Mutationsproben) stehen in `pruefliste.md` dieser Change und wandern mit ihr ins
Archiv. Der Kommentar in `pages/kraefteuebersichtPrint.css`, der LFH-729 nennt, wird
nachgezogen.

## Risks / Trade-offs

- [Firefox oder WebKit rechnen ein Maß anders, etwa die Endmarke knapp unter der A4-Höhe] →
  Die Schwellen bleiben, und jede Abweichung wird als Befund untersucht. Keine Toleranz je
  Engine ohne Messwert in `pruefliste.md`. Ein dauerhaft rotes Gate, das jemand abschaltet,
  wäre schlechter.
- [Firefox oder WebKit scheitern an etwas, das mit dem Druck nichts zu tun hat (Anmeldung,
  Vite-Kaltstart)] → Die Fälle nutzen dieselben Helfer wie in Chromium. Was dabei auffällt, ist
  ein eigener Befund. Er wird nicht in den Druckfall eingeschmiert, sondern bei Bedarf als
  ClickUp-Task angelegt.
- [`etb-druck` sät 510 Einträge, im lokalen Vollauf dreimal parallel auf derselben SQLite] →
  Die 503-Wiederholung im Seeding gibt es schon. Die Frist von 240 s gilt je Fall. In der CI
  laufen Firefox und WebKit im eigenen Job, nicht neben den Chromium-Shards.
- [Lokal fehlen Firefox und WebKit (auch in dieser Cloud-Umgebung)] → D2 bricht mit klarer
  Anweisung ab. Für die Umsetzung hier wird `playwright install firefox webkit` versucht
  (nur diese beiden; Chromium bleibt aus `/opt/pw-browsers`). Scheitert das am Netz oder an
  den Systempaketen, belegt erst die CI des PRs die beiden Projekte, und das wird so gemeldet.
- [Der neue Check ist nicht required (D1)] → `release.needs` sperrt den Release. Der
  Ruleset-Eintrag steht als offener Handgriff in tasks.md und in der Abschlussmeldung.
- [`pdfjs-dist` bekommt ein `high`-Advisory] → `check-deps.sh` wird rot, wie bei jeder anderen
  Abhängigkeit, und der Fund wird nach der Regel in `pnpm-workspace.yaml` behoben. Da das Paket
  nur im Test liest, ist die Fläche klein.

## Migration Plan

Kein Daten- oder Laufzeitwechsel. Reihenfolge im PR: Abhängigkeit, Config und Spec, Gate, CI.
Rückweg: Den neuen Job aus `ci.yml` nehmen und `PW_PROJEKTE=chromium` stehen lassen. Die
Chromium-Fälle bleiben dann unverändert wirksam.
