# Rundgang für Erstnutzer (LLH-1990)

Zunder: https://zunder.rubeen.dev/#/aufgabe/kgsx7ta3rfv4mgbxe3co20t8

## Absicht

Die Willkommenskarte aus LLH-1824 (`frontend/src/hilfe/WillkommenKarte.tsx`) sagt in drei Sätzen,
wo es langgeht. Am Checkpoint vom 19.11.2026 hat Ruben festgelegt: Die Einführung muss
**anschaulich** sein. Erstnutzer öffnen die App zum ersten Mal in einer **Einführungsrunde**
(Schulung, ruhige Lage), **nie im Einsatz**. Ein Rundgang mit Sprechblasen an der echten
Oberfläche zeigt ihnen, wo Kopf, Kategorien, Module, Hilfe und Suche liegen.

## Ziele

- Ein geführter Rundgang in zwei Teilen an der echten Oberfläche:
  - **Teil „Liste“** auf der Einsatzliste.
  - **Teil „Einsatz“** beim ersten Öffnen eines Einsatzes.
- Jeder Teil erscheint von selbst höchstens einmal je Benutzer und lässt sich jederzeit wieder
  aufrufen.
- Er ist jederzeit abbrechbar, ohne Spuren.
- Er hängt an der Willkommenskarte.

## Nicht-Ziele

- Kein Video und keine Animation; keine bebilderte Einweisung als eigene Seite (die Einweisung der
  Hilfe bleibt, wie sie ist).
- Keine Rundgänge je Modul (ETB, Lagekarte …). Der Aufbau ist so, dass ein weiterer Teil später
  dazukommen kann, gebaut wird er nicht.
- Kein Rundgang auf dem Handy (Kontext mobil) und auf gekoppelten Geräten.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Der Rundgang springt in einem **echten** Einsatz von selbst auf.
- Er kommt nach dem Beenden wieder, weil ein Stand noch lädt oder ein Speichern scheitert und
  dann jede Sitzung erneut auslöst.
- Wer die App schon kennt (Willkommenskarte geschlossen), wird nach dem Update überfallen.
- Eine Sprechblase zeigt auf nichts (Ziel fehlt, weil Recht, Breite oder Moduleinstellung es
  ausblenden) oder blockiert die Seite ohne Ausweg.

## Rahmen

- **Regel „Text erklärt nie die Bedienung“** (LFH-1078, `frontend/AGENTS.md`, Bedien-Leitlinie):
  Der Rundgang ist die **ausdrückliche Ausnahme** (Entscheidung Ruben, 20.11.2026). Sie wird als
  Regel dort eingetragen und ist eng: nur die Texte des Rundgangs, an einer Stelle gebündelt.
- **Keine Anrede** (LLH-1830): auch im Rundgang kein Du und kein Sie; Sache benennen oder Infinitiv.
- **Kürzel** (LLH-1750): nur eingeführte Kürzel.
- **Bedienkontexte:** Fükw und Führungs-Tablet (Touch, Handschuh-Dichte) bekommen den Rundgang;
  Knöpfe der Sprechblase in der Zielgröße der aktiven Dichte.
- **Benutzer-Einstellungen:** Der Server nimmt nur Schlüssel aus `BEKANNTE_SCHLUESSEL`
  (`src/benutzer_einstellungen/mod.rs`) an; jeder neue Schlüssel steht dort und im Frontend
  gespiegelt (Muster `SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN`, `frontend/src/hilfe/willkommen.ts`).
- **Doku-Mitänderung:** Das Kapitel `docs/anwender/kapitel/einsatz-oberflaeche.md` nennt in
  `quellen` die berührten Dateien und beschreibt den Rundgang (`docs/anwender/AGENTS.md`).

## Ansätze

Form (in der Aufgabe offen gelassen):

1. **Geführter Rundgang mit Sprechblasen an der echten Oberfläche** — gewählt. Am
   anschaulichsten, weil er auf die echten Teile zeigt; in einer Schulung stört er nicht.
   Kostet die Ausnahme von LFH-1078.
2. Bebilderte Einweisung aus dem Doku-Bildlauf — billig (Bilder liegen vor), aber zeigt Bilder
   statt der eigenen Oberfläche; verworfen.
3. Video/Animation — teuer zu pflegen, veraltet bei jeder Gestaltungsänderung; verworfen.

Schnitt des Rundgangs (am Phase-1-Checkpoint gewählt: **A**):

- **A — zweigeteilt (gewählt):** Teil „Liste“ auf der Einsatzliste, Teil „Einsatz“ beim ersten
  Öffnen eines Einsatzes. Trägt auch ohne Übungseinsatz in der Schulung.
- B — eine Tour am Stück, die selbst in einen Übungseinsatz führt: braucht einen Einsatz mit
  Mitgliedschaft; verworfen.
- C — nur im Einsatz: lässt den ersten Bildschirm aus; verworfen.

Technik (Entscheidung des Agenten): **antd `Tour`** (antd 6 ist im Projekt, `Tour` ist bisher
ungenutzt) statt einer Fremdbibliothek oder eines Eigenbaus. Grund: Theme-Token, Fokusführung und
Positionierung kommen mit; keine neue Abhängigkeit.

## Verhalten

### Teil „Liste“

Schritte (Ziele über vorhandene oder neue `data-lfh`-Anker):

1. Eine Einsatzkachel (`einsatzkachel`, die erste). Fehlt jede Kachel, entfällt der Schritt.
2. Die Suche bzw. Sprungpalette in der Kopfzeile.
3. Der ?-Knopf (Hilfe zur Seite).
4. Das Benutzermenü (Profil, Darstellung, Hilfe).

**Von selbst** startet er, wenn alle Bedingungen gelten:

- Der Stand der Benutzer-Einstellungen ist **bekannt** (geladen).
- Die Willkommenskarte ist noch offen (`willkommen_geschlossen` fehlt).
- `rundgang_liste_gesehen` fehlt.
- Es ist kein Gerätekonto und nicht der Kontext mobil.

Wer die Karte schon geschlossen hat, gilt als kundig: kein Selbststart.

### Teil „Einsatz“

Schritte:

1. Kopfzeile mit Einsatzname.
2. Kategorien (Leiste links, `rail-spalte`).
3. Module der gewählten Kategorie (`modul-panel`).
4. Suche im Kopf (`kopf-suche`).
5. ?-Knopf.

**Von selbst** startet er nur, wenn alle Bedingungen gelten:

- Der Einsatz ist eine **Übung** (`isUebung`, dieselbe Quelle wie die Marke „ÜBUNG“).
- Der Stand der Benutzer-Einstellungen ist bekannt.
- `rundgang_einsatz_gesehen` fehlt.
- Die Person ist Erstnutzer: Die Willkommenskarte ist noch offen **oder**
  `rundgang_liste_gesehen` ist gesetzt (Teil „Liste“ lief nach dem Update). Wer die Karte vor dem
  Update geschlossen hat, hat keinen der beiden Stände und bleibt unbehelligt. *(Entscheidung des
  Agenten nach der Prüfung.)*
- Es ist kein Gerätekonto und nicht der Kontext mobil.

In einem echten Einsatz startet er nie von selbst, nur auf Wunsch.

Der Starter hängt am Rahmen des Einsatzes (`EinsatzLayout`), nicht an einer Modulseite: Der
erste Aufruf irgendeiner Route im Einsatz zählt, auch ein Deeplink in ein Modul. Die Ziele des
Teils liegen alle im Rahmen, also unabhängig vom Modul. *(Entscheidung des Agenten.)*

**Geschlossenes Modulpaneel** (Tablet-Breite: Paneel standardmäßig zu; schmaler: Leiste und
Paneel in einer Schublade): Der Rundgang öffnet und schließt nichts, er verändert keinen
Bedienstand. Ist `modul-panel` nicht sichtbar, zeigt der Schritt „Module“ auf die Leiste der
Kategorien und sagt, dass ein Tippen auf eine Kategorie ihre Module öffnet; ist auch die Leiste
nicht sichtbar (Schublade), zeigt er auf ihren Öffner im Kopf. Fehlt jedes Ziel, entfällt der
Schritt. *(Entscheidung des Agenten.)*

### Bedienung in beiden Teilen

- Jede Sprechblase hat einen Titel (die Sache, z. B. „Kategorien“), ein bis zwei Sätze ohne
  Anrede, einen Schrittzähler „2/5“ und die Knöpfe „Zurück“, „Weiter“ (im letzten Schritt
  „Fertig“) und „Rundgang beenden“.
- **Esc** wirkt wie „Rundgang beenden“.
- Der Gesehen-Schlüssel des Teils wird gesetzt, **sobald die erste Sprechblase steht**, nicht
  erst bei Fertig, Beenden oder Esc. So kommt ein unterbrochener Rundgang (Wegnavigieren, Neuladen,
  abgelaufene Sitzung) nicht von selbst wieder; erneut ansehen geht über Karte oder Sprungpalette.
  *(Entscheidung des Agenten nach der Prüfung.)* Gespeichert wird wie bei der
  Willkommenskarte: sofort lokal in den Query-Cache, nur den eigenen Schlüssel ergänzen, Fehler
  schlucken.
- Ein Schritt, dessen Ziel nicht im DOM steht, wird beim Start herausgefiltert. Bleibt kein
  Schritt übrig, startet der Teil nicht und gilt nicht als gesehen.
- Schritte ohne Maske, die die Seite sperrt, sind nicht nötig: eine Maske ist erlaubt, solange
  „Rundgang beenden“ und Esc immer erreichbar sind.

### Wieder aufrufen

- Die **Willkommenskarte** bekommt den Knopf „Rundgang starten“ (startet Teil „Liste“). Wer den
  Rundgang dort startet, schließt die Karte damit nicht.
- Die **Sprungpalette** bekommt den Befehl „Rundgang“ (Gruppe navigation, Schlagworte etwa
  „Einführung“, „Tour“, „Erste Schritte“). Er startet den Teil der aktuellen Seite: auf der
  Einsatzliste „Liste“, in einem Einsatz „Einsatz“, sonst keinen Befehl. Nicht im Kontext mobil,
  nicht für Gerätekonten.
- Manuelles Starten ignoriert die Gesehen-Schlüssel.

## Daten

- Zwei neue Schlüssel in den Benutzer-Einstellungen:
  - `rundgang_liste_gesehen`
  - `rundgang_einsatz_gesehen`

  Der Wert ist opak (Zeitpunkt wie bei `willkommen_geschlossen`), es zählt nur, ob er da ist.
- Backend: Konstanten und Einträge in `BEKANNTE_SCHLUESSEL` samt Tests wie beim Willkommens-Schlüssel.
  Keine Migration (das Fach ist schon da).
- Frontend: Spiegel der Konstanten und eine reine Funktion je Teil („soll von selbst starten?“)
  neben `istWillkommenOffen`.

## Regeln und Doku

- `frontend/AGENTS.md`, Bedien-Leitlinie, Abschnitt „Texte: zeigen statt erklären“: Ausnahme
  „Rundgang (LLH-1990)“. Erklärende Texte sind dort erlaubt, aber nur in der einen Datei mit den
  Schritt-Texten. Die Anrede-Regel gilt weiter.
- Wächter `components/erklaertext.guard.test.ts`: nimmt genau diese Datei aus; der
  Anrede-Wächter nimmt sie **nicht** aus.
- `docs/anwender/kapitel/einsatz-oberflaeche.md`: kurzer Ablauf „Den Rundgang starten“ (Karte,
  Sprungpalette; Selbststart nur in Übungseinsätzen), neue Dateien in `quellen`.

## Dem Bauenden überlassen

- Dateischnitt im Ordner `frontend/src/hilfe/` (etwa `rundgang/`), Name des Kontext-Hooks, wie
  Willkommenskarte, Palette und Seiten denselben Starter erreichen.
- Wortlaut der Schritt-Texte im Rahmen oben (kurz, ohne Anrede).
- Welche Anker neu als `data-lfh` dazukommen (?-Knopf, Benutzermenü, Suche der Einsatzliste).
- Ob die Maske an ist.
- Tests: reine Funktionen für den Selbststart (Tabelle der Bedingungen), Komponententests für
  Start, Beenden und Esc (Schlüssel gesetzt) und für fehlende Ziele; ein Test, dass ein echter
  Einsatz nicht von selbst startet.
