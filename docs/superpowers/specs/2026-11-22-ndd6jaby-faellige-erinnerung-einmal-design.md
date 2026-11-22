# Fällige Erinnerung nur einmal: die automatische Frist steht am Bezug

Zunder: https://zunder.rubeen.dev/#/aufgabe/ndd6jaby8ednfan6z2wx3usx (LLH-1908, aus LLH-1737,
Elternthema LLH-1716). Lösungsweg abgestimmt am 22.11.2026 (Phase-1-Checkpoint, alle drei
Empfehlungen angenommen).

## Absicht

Eine automatische Frist (Erinnerung mit `quelle = 'auto_frist'`) erscheint heute bis zu viermal.
Ein Beispiel ist „Sofortmeldung #3 unbestätigt“: Sie steht unter „Offene Vorgänge → Erinnerungen“,
an der Meldung („Bestätigung überfällig“), in „Nächste Marken“ und im Alarm („Bestätigung
ausstehend“). Dazu zählt sie in jeder Zahl doppelt. Eine Einsatzkraft liest das als zwei offene
Dinge und quittiert womöglich das falsche. Künftig gilt: **Eine automatische Frist steht dort, wo
man sie erledigt, nämlich an ihrem Bezug.** Jede Kachel und jede Zahl zeigt sie einmal.

## Bestand (gemessen am 22.11.2026)

Automatische Fristen legt der Server für drei Bezüge an:

| Bezug (`bezug_typ`) | Titel | Wo der Bezug sie schon trägt |
| --- | --- | --- |
| `meldung` | „Sofortmeldung #n unbestätigt“ (`meldung::auto_frist_titel`) | Offene Vorgänge → Meldungen: „Bestätigung überfällig“, Zähler `meldungen.bestaetigung_ueberfaellig` |
| `auftrag` | „Auftrag #n Quittierfrist“ (`auftrag::quittierfrist_titel`), fällig zu `frist_at` | Offene Vorgänge → Aufträge: „überfällig“, Zähler `auftraege.ueberfaellig`; Nächste Marken: Marke `a-<id>` |
| `abloesung`, `abloesung_vorwarnung` | „Ablösung fällig: …“, „Ablösung in n min: …“ | Offene Vorgänge → Ablösungen (Vorwarnzeit oder überfällig, `countFaellige`); Nächste Marken: Ablösungsmarke |
| `abloesung_planung` | „Keine ablösende Einheit geplant: …“ | **nirgends sonst** in Offene Vorgänge oder einem Zähler; Nächste Marken überspringt ihn schon heute |

Doppelt erscheinen sie heute hier:

1. **Offene Vorgänge → Erinnerungen** (`vorgangsErinnerungen`): alle offenen, fälligen oder bald
   fälligen Erinnerungen, auch die automatischen, also zusätzlich zum Bezug im selben Paneel.
2. **Nächste Marken** (`naechsteMarken`): Die Ablösung ist schon ausgenommen. Ein Auftrag mit
   Frist steht **zweimal in derselben Liste**, als Auftrag und als „Quittierfrist“. Die
   Bestätigungsfrist einer Meldung steht als Erinnerung, ihr Klick führt ins Erinnerungsmodul
   statt zur Meldung.
3. **Zähler „Erinnerungen fällig“** (`erinnerung::repo::faellige_offene`): Er zählt alle fälligen
   offenen Erinnerungen. Daraus lesen der Modulzähler, „Was brennt“ (`useWasBrennt`), das
   Lage-Dashboard (`fuehrungsZahlen`), die Zahl in Offene Vorgänge und die Alarmzeile des
   Lagemonitors (`routes::lagemonitor::alarm`, `erinnerungen_faellig`). Überall zählt dieselbe Frist
   ein zweites Mal neben „Bestätigung überfällig“ bzw. „Auftrag überfällig“.
4. **Alarm**: Das Backend meldet je Anlass genau eine Art (`erinnerung/benachrichtigung.rs`). Eine
   Meldungsfrist meldet sich nur als `sofortmeldung_eskaliert`, eine Auftragsfrist als
   `auftrag_ueberfaellig`. Hier gibt es kein Doppel.

## Ziele

- Z1: In „Offene Vorgänge“ steht eine automatische Frist nur am Bezug.
- Z2: In „Nächste Marken“ steht jede Frist genau einmal, und ihr Klick führt zum Bezug.
- Z3: Jede Zahl (Modulzähler, „Was brennt“, Dashboard, Offene Vorgänge, Lagemonitor) zählt eine
  Frist genau einmal.

## Nicht-Ziele

- Das Erinnerungsmodul selbst ändert sich nicht. Es zeigt weiter alle Erinnerungen, die
  automatischen mit dem Etikett „automatisch“ (`ErinnerungKarte`).
- Alarm und Benachrichtigungen ändern sich nicht. Sie sind schon entdoppelt (Punkt 4).
- Selbst angelegte Erinnerungen mit Bezug auf eine Meldung oder einen Auftrag bleiben
  Erinnerungen. Sie sind ein eigener Wecker einer Person, keine Frist des Bezugs.
- Nichts am Wire ändert sich: Es kommen keine neuen Felder dazu, es gibt keinen Typ-Codegen. Nur
  die Zahl `ErinnerungsZaehler.faellig` und `LagemonitorAlarm.erinnerungen_faellig` bedeuten
  enger, was sie immer meinen sollten.

## Ansätze

- **A „Am Bezug“ (gewählt):** Die Frist steht am Bezug, die Erinnerungslisten außerhalb des
  Moduls lassen sie aus. Begründung: Erledigt wird am Bezug (Meldung bestätigen, Auftrag
  quittieren, Ablösung vollziehen). Die Erinnerung ist dort nur der Mechanismus der Frist.
- B „Als Erinnerung“ (verworfen): Die Frist steht unter „Erinnerungen“, der Bezug verliert seine
  Markierung. Verworfen, weil dann in der Meldungsliste nicht mehr sichtbar wäre, welche Meldung
  bestätigt werden muss.
- Für „Nächste Marken“ verworfen: die Bestätigungsfrist nur bis zur Fälligkeit oder gar nicht
  zeigen. Gewählt ist, dass sie bleibt. „Nächste Marken“ ist die Zeitleiste, „Offene Vorgänge“
  die Arbeitsliste; Aufträge und Ablösungen stehen schon heute in beiden. Entdoppelt wird
  innerhalb jeder Kachel.
- Für die Zahl verworfen: nur die Zahl in Offene Vorgänge im Client aus der gefilterten Liste
  bilden. Dann zeigten Modulzähler, „Was brennt“ und Dashboard weiter eine andere Zahl für
  dieselbe Sache.

## Die Regeln (wie entschieden)

### R1 Welche Fristen am Bezug stehen

Eine Erinnerung gilt als **am Bezug getragen**, wenn `quelle = 'auto_frist'` ist und ihr
`bezug_typ` einer dieser vier ist: `meldung`, `auftrag`, `abloesung` oder
`abloesung_vorwarnung`. Hinzu kommt, dass **die Person das Modul des Bezugs sieht**
(`meldungen`, `auftraege`, `abloesung`). Ohne das Modul sähe sie die Frist sonst nirgends;
dann bleibt sie eine Erinnerung.

`abloesung_planung` gehört **nicht** dazu: Den Planungshinweis zeigt keine andere Liste und
kein anderer Zähler. Er bleibt in Offene Vorgänge → Erinnerungen und im Zähler. Dass Nächste
Marken ihn schon heute überspringt, bleibt wie es ist; das ist eine eigene Frage, nicht diese.

### R2 Offene Vorgänge → Erinnerungen

`vorgangsErinnerungen` lässt die am Bezug getragenen Erinnerungen aus. Welche Module frei sind,
bekommt es vom Paneel (`meldungen.frei`, `auftraege.frei`, `abloesungen.frei`). Die Zahl des
Abschnitts bleibt die Zahl des Servers (R4); Liste und Zahl folgen derselben Regel R1.

### R3 Nächste Marken

- Eine am Bezug getragene Auftragsfrist entfällt, wenn der Auftrag selbst eine Marke hat (`a-<id>`
  steht schon in der Liste). Gibt es diese Marke nicht, etwa weil das Modul Aufträge nicht frei
  ist, bleibt die Erinnerung, wie heute.
- Die Bestätigungsfrist einer Meldung (automatische Frist mit Bezug `meldung`) wird eine eigene
  Markenart `bestaetigung`: gleicher Text („Sofortmeldung #3 unbestätigt“), `id` = Meldung. Ist
  sie verstrichen (Uhr oder Server `ist_faellig`), heißt sie „überfällig“ in Rot. Sie ist eine
  Frist, kein Wecker, und spricht damit wie „Bestätigung überfällig“ in Offene Vorgänge. Ihr
  Klick öffnet die Meldung im Modul Meldungen (`meldungenPfad({ meldung })`). Ist das Modul
  Meldungen nicht frei, bleibt sie eine Erinnerungsmarke wie heute.
- Ablösungsfristen bleiben ausgenommen (Bestand).

### R4 Der Zähler „Erinnerungen fällig“

`erinnerung::repo::faellige_offene` nimmt die Bezugstypen, die er auslässt, als Argument. Der
Modulzähler (`einsatz::zaehler::berechne`) leitet sie aus den erlaubten Modulen ab (R1). Der
Lagemonitor zählt ohne Rechteprüfung und zeigt Meldungen und Aufträge in derselben Alarmzeile;
er lässt `meldung` und `auftrag` aus (Ablösungen zeigt seine Alarmzeile nicht, also bleiben sie
dort Erinnerungen). Daraus folgen Modulzähler, „Was brennt“, Dashboard und die Zahl in
Offene Vorgänge ohne eigene Änderung.

### R5 Ort der Regel

Die Regel „Automatische Fristen stehen am Bezug“ steht genau einmal, in `src/AGENTS.md` (neuer
kurzer Abschnitt bei „Benachrichtigungen“, der schon „je Anlass genau eine Art“ trägt). Sie gilt
für Server und Client. Code-Kommentare an `faellige_offene`, `vorgangsErinnerungen` und
`naechsteMarken` verweisen dorthin. Die Menge der Bezugstypen steht je Seite einmal als Konstante
(Rust in `erinnerung`, TypeScript in `erinnerung/`), damit eine neue Auto-Frist-Art an einer
Stelle nachgezogen wird.

### R6 Anwenderdoku

`docs/anwender/kapitel/ueberblick.md` (Offene Vorgänge, Nächste Marken) und
`docs/anwender/kapitel/erinnerungen.md` (automatische Erinnerungen) erhalten je einen Satz: Wo die
automatische Frist steht, und dass der Zähler „Erinnerungen“ nur die eigenen Erinnerungen zählt.
Dafür gilt die Mitänderungsregel in `docs/anwender/AGENTS.md`.

## Bediensicht vorher → nachher

| Stelle | Vorher | Nachher |
| --- | --- | --- |
| Offene Vorgänge → Meldungen | Sofortmeldung, „Bestätigung überfällig“ | unverändert |
| Offene Vorgänge → Erinnerungen | zusätzlich „Sofortmeldung #3 unbestätigt“ (Zahl 1) | fehlt (Zahl 0), eigene Erinnerungen bleiben |
| Nächste Marken | „Sofortmeldung #3 unbestätigt · fällig“ (gelb), Klick → Erinnerung | „… · überfällig“ (rot), Klick → Meldung |
| Nächste Marken, Auftrag mit Frist | zwei Zeilen (Auftrag + Quittierfrist) | eine Zeile (Auftrag) |
| Modulzähler Erinnerungen, „Was brennt“, Dashboard, Lagemonitor | zählt die Frist mit | zählt nur eigene Erinnerungen (und Planungshinweise) |
| Erinnerungsmodul | alle, „automatisch“ markiert | unverändert |
| Alarm „Bestätigung ausstehend“ | einmal | unverändert |

## Prüfung

- Rust: `faellige_offene` mit und ohne ausgelassene Bezüge (Auto-Frist Meldung, Auftrag,
  Ablösung, Planung, selbst angelegte mit Bezug); Modulzähler mit erlaubtem bzw. fehlendem Modul
  Meldungen; Lagemonitor-Alarm.
- Vitest: `vorgangsErinnerungen` (je Bezugstyp, frei/nicht frei, selbst angelegt mit Bezug);
  `naechsteMarken` (Auftragsfrist doppelt → einmal; ohne Auftragsmarke bleibt sie;
  Bestätigungsfrist → Art `bestaetigung`, „überfällig“, `id` = Meldung; Meldungen nicht frei →
  Erinnerung wie bisher).
- Bild: Überblick mit einer unbestätigten Sofortmeldung und einem Auftrag mit Frist, vorher und
  nachher.

## Was beim Bauen zu entscheiden bleibt

- Wie `naechsteMarken` „Meldungen frei“ erfährt: als zusätzliches Argument (die Funktion hat schon
  acht Positionsparameter) oder durch Vorfiltern im Aufrufer. Das ist reine Technik ohne Wirkung
  auf die Bediensicht.
