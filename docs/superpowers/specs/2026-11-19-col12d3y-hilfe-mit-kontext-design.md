# Hilfe mit Kontext: „?“ öffnet das Kapitel zur Seite (LLH-1824)

Zunder: https://zunder.rubeen.dev/#/aufgabe/col12d3ymod85y66w5kv5huv
Parent: LLH-1812 „Grundmuster: Zustände, Hilfe, Tastatur, Sprache“, Welle 2
Route: `entwurf` (E1 Form der Seitenleiste, E2 neue Regeln Seite→Kapitel und globale Hilfetaste,
E3 Frontend, Backend und Arbeitsanleitungen)

## Absicht

Die UI/UX-Analyse vom 12.11.2026 (LLH-1714) hat festgestellt: Hilfe gibt es nur im Benutzermenü,
und sie öffnet immer die Übersicht `/hilfe`. Die Tasten „?“ und F1 tun nichts. Eine Übersicht der
Tastenkürzel gibt es nicht, eine Einführung für Erstnutzer auch nicht. Wer im Einsatz an einer
Seite hängt, soll die passende Erklärung mit einem Griff neben der Arbeit lesen können, ohne die
Seite zu verlassen und ohne in 66 Kapiteln zu suchen.

Befund am Code (19.11.2026): Die Palettenzeile „Hilfe“ (`nav:hilfe` in
`command-palette/befehle.ts`) und der Rückweg aus der Hilfe (LLH-1731) gibt es schon. Diese
Punkte der Aufgabe sind erledigt.

## Ziele

1. Ein Knopf „?“ im Kopf des Einsatzrahmens und des App-Rahmens (Ebene 1: Einsatzliste,
   Verwaltung, Profil) öffnet rechts eine **Hilfe-Seitenleiste** mit dem Kapitel zur aktuellen
   Seite. Die Seite bleibt daneben sichtbar.
2. Die Tasten **„?“** und **F1** öffnen dieselbe Seitenleiste, außer der Fokus steht in einem
   Eingabefeld.
3. Die Seitenleiste hat zwei Reiter: **„Zu dieser Seite“** und **„Tastenkürzel“**.
4. Die Sprungpalette bietet **„Hilfe zu dieser Seite“** und **„Tastenkürzel“** an.
5. Eine **Willkommenskarte** auf der Einsatzliste führt Erstnutzer an Hilfe, „?“ und
   Sprungpalette heran. Sie bleibt, bis die Person sie schließt.

## Nicht-Ziele

- Keine geführte Tour und keine bebilderte Einführung. Die anschauliche Einführung ist die
  Folgeaufgabe LLH-1990.
- Kein Glossar und keine Legende der Fachkürzel. Das ist LLH-1825, das parallel läuft.
- Keine Hilfe in der Gerätehülle. Sie hat eine eigene Bedienung ohne Kopf mit Benutzermenü.
- Die Hilfeseite `/hilfe` selbst ändert sich nicht, abgesehen von der neuen Taste.
- Kein neues Kapitel schreiben. Die Seitenleiste zeigt die vorhandenen Kapitel.

## Anti-Ziele

- Die Hilfe darf die Arbeit nicht verdecken oder unterbrechen: kein Modal, kein automatisches
  Aufklappen, keine Karte im Einsatz.
- „?“ darf beim Tippen nie auslösen. Ein Fragezeichen im ETB-Text ist Text.
- Die Kapiteltexte dürfen nicht in den Haupt-Chunk wandern (`docs/anwender/AGENTS.md`, „Hilfe in
  der App“).
- Keine Seite ohne Kapitel: ein neues Modul ohne Zuordnung macht einen Test rot, statt still auf
  die Übersicht zu fallen.

## Rahmenbedingungen

- `docs/anwender/AGENTS.md`, „Hilfe in der App“: `hilfe/gruppen.ts` bleibt ohne Kapiteltexte, der
  Hilfe-Chunk wird per `lazy` geladen, der Service Worker hält ihn vor.
- `frontend/AGENTS.md`, „UI-Form-Leitlinie (Drawer-Nutzung)“: Drawer nur zum Ansehen, bisher
  einzige Ausnahme der Navigations-Drawer. Reiter oder mehr als ~480 px führen dort auf eine eigene
  Route. Die Hilfe-Seitenleiste ist nur zum Lesen, hat aber zwei Reiter. Sie wird deshalb als
  **zweite benannte Ausnahme** in die Leitlinie eingetragen: ein Nachschlagewerk neben der Arbeit,
  keine Entität. Die volle Hilfe bleibt die eigene Route `/hilfe/<kapitel>`.
- ADR-0061: Reiter sind eine `Segmentleiste rolle="tablist"`, keine antd-`Tabs`.
- ADR-0056: Die Seitenleiste klebt nicht im Rahmen. Sie ist ein Drawer über dem Inhalt.
- `command-palette/AGENTS.md`: Zeigerart über `useViewport().istBeruehrung`, nie über die Breite.
  Navigationszeilen nur über `sprungZu`.
- `src/benutzer_einstellungen/mod.rs`: Ein neuer Schlüssel ist eine Zeile in
  `BEKANNTE_SCHLUESSEL`.
- Mitänderungsregel der Anwenderdoku (`docs/anwender/AGENTS.md`): Das Kapitel
  „Einsatz-Oberfläche“ beschreibt Kopfzeile und Sprungpalette und bekommt einen Ablauf
  „Hilfe zur Seite öffnen“. Die neuen Code-Pfade kommen in seine `quellen`.

## Ansätze

Die Form hat der Mensch am Checkpoint am 19.11.2026 gewählt.

**Darstellung**

- **Gewählt: Seitenleiste.** Ein Drawer rechts mit dem Kapiteltext, die Seite bleibt daneben
  bedienbar. Der Kapiteltext wird erst beim Öffnen geladen (eigener Chunk). Ein Link „In der
  Hilfe öffnen“ führt zur vollen Hilfe.
- Verworfen: direkt zur Hilfeseite springen. Wenig Code, aber man verlässt die Seite. Das ist der
  heutige Weg über das Benutzermenü und das Problem der Analyse.

**Zuordnung Seite → Kapitel**

- **Gewählt: Feld an der Modul-Registry.** Jeder `ModulEintrag` nennt sein Kapitel
  (`hilfeKapitel`). Für Seiten ohne Modul gibt es eine kleine Tabelle Pfadmuster → Kapitel. Ein
  Wächter-Test prüft, dass jedes genannte Kapitel existiert und jedes Modul eins hat.
- Verworfen: aus den `quellen` der Kapitel ableiten. Es braucht keine Pflege, ist aber mehrdeutig
  (`Datensicht.tsx` steht in vielen Kapiteln) und braucht zur Laufzeit das Wissen, welche
  Komponente zu welcher Route gehört.

**Tastenkürzel**

- **Gewählt: Reiter in der Seitenleiste.** Die Einträge kommen aus einer Tabelle im Code, mit den
  richtigen Tasten je Plattform (⌘ oder Strg).
- Verworfen: ein eigenes Dialogfenster (ein zweiter Ort für Hilfe). Ebenfalls verworfen: ein
  Doku-Kapitel als Text, weil es veraltet, sobald sich ein Kürzel ändert.

**Einführung**

- **Gewählt: Willkommenskarte** nach dem Muster `NeuigkeitenHinweis`. Der Mensch verlangt eine
  anschauliche Einführung als eigene Aufgabe (LLH-1990). Die Karte ist der Einstieg, an den diese
  Einführung später anknüpft.
- Verworfen für jetzt: eine geführte Tour, und als Reiter „Erste Schritte“ mit Selbstöffnen.

## Entwurf

### 1. Zuordnung Seite → Kapitel

- `ModulEintrag` (`einsatz/modulRegistry.ts`) bekommt das Pflichtfeld `hilfeKapitel: string`, den
  Slug eines Kapitels unter `docs/anwender/kapitel/`. Beispiele: `lagekarte` → `lagekarte`,
  `etb` → `einsatztagebuch`, `personen` → `betroffene`, `uebersicht` → `ueberblick`. Die
  Zuordnung je Modul trifft der Bauende, anhand der `quellen` der Kapitel (die Seite des Moduls
  steht dort).
- Neue Datei `hilfe/kontextKapitel.ts`, **ohne Kapiteltexte**, damit sie den Hilfe-Chunk nicht
  in den Haupt-Chunk zieht:
  - `KAPITEL_JE_PFAD`: eine geordnete Liste von Pfadmustern für Seiten ohne Modul. Etwa
    `/einsaetze` (Liste) → `einsatz-oberflaeche`, `/einsaetze/:id/einstellungen/*` →
    `einsatz-einstellungen`, `/profil` → `profil-sicherheit`, `/admin/benutzer` → `benutzer`,
    `/admin/*` → `verwaltung`, `/benachrichtigungen` → `einsatz-oberflaeche`. Die vollständige
    Liste entsteht beim Bauen aus `App.tsx`.
  - `kapitelFuerPfad(pfad): string`: Zuerst die Tabelle, dann das Modul aus dem Pfad
    `/einsaetze/:id/<route>` über die Registry. Ohne Treffer gilt `einsatz-oberflaeche`.
- Wächter (`hilfe/kontextKapitel.guard.test.ts`): Jedes `hilfeKapitel` und jedes Ziel der
  Tabelle ist ein Slug aus `hilfe/kapitel.ts`. Jeder Registry-Eintrag hat eins (das ergibt sich
  aus dem Pflichtfeld). Ein Fall pro Tabellenmuster belegt die Auflösung.
- Neue Regel in `docs/anwender/AGENTS.md`, „Hilfe in der App“: Jedes Modul nennt sein Kapitel,
  jede Seite ohne Modul steht in `KAPITEL_JE_PFAD`.

### 2. Hilfe-Seitenleiste

- `hilfe/HilfeSeitenleisteProvider.tsx` (im Haupt-Chunk, klein): Er hält `offen` und `reiter`
  (`'seite' | 'kuerzel'`) und stellt `oeffneHilfe(reiter?)` bereit. Er hängt den globalen
  Tastenhandler an und lädt den Inhalt per `lazy`. *(Entscheidung beim Entwurf)* Montiert wird er
  **einmal** in `App.tsx`, innerhalb von `AuthProvider` und **über** `CommandPaletteProvider`.
  So erreicht die Palette `oeffneHilfe` über den Kontext, und die Leiste bleibt auch beim Wechsel
  von der Einsatzliste in einen Einsatz offen. Aktiv ist er nur mit angemeldetem Benutzer, nicht
  auf dem gekoppelten Gerät und nicht unter `/hilfe` oder dem Gerätepfad. Sonst gibt er
  `oeffneHilfe = undefined` heraus, und Tasten, Knopf und Palettenzeilen fehlen.
- `hilfe/HilfeSeitenleiste.tsx` (lazy, eigener Chunk, importiert `kapitel.ts`): ein antd-`Drawer`
  rechts.
  - Breite 480 px. Unter `lg` und bei Berührung (`istBeruehrung`) volle Breite.
  - Kopf: Kapiteltitel, darunter die Segmentleiste „Zu dieser Seite | Tastenkürzel“. Der Reiter
    „Tastenkürzel“ fehlt bei Berührung, dann gibt es auch keine Segmentleiste.
  - Reiter „Zu dieser Seite“: der Kapiteltext, mit demselben Markdown-Renderer und denselben
    Bildern wie `HilfePage` (`HilfeBild`). Was die Hilfeseite dafür nutzt, wird gemeinsam
    genutzt, nicht kopiert. Am Ende stehen die Links „In der Hilfe öffnen“
    (`hilfePfad({ kapitel, von })`, ab `lg` mit Maus im neuen Tab wie heute im Benutzermenü) und
    „Alle Kapitel“.
  - Verweise im Kapiteltext auf andere Kapitel öffnen die volle Hilfe und schließen die
    Seitenleiste.
  - Beim Seitenwechsel bei offener Leiste wechselt der Inhalt auf das Kapitel der neuen Seite. Die
    Leiste bleibt offen, und die Leseposition beginnt oben.
  - Esc schließt die Leiste, und der Fokus geht zurück auf den Auslöser.
  - Während der Chunk lädt, steht ein Gerippe. Ohne Netz kommt der Chunk aus dem Service Worker.
    Fehlt er trotzdem, steht dort „Hilfe ist gerade nicht verfügbar“ mit dem Link zur vollen
    Hilfe.
- **Knopf „?“ im Kopf:** Ein Bedienziel mit Fragezeichen-Symbol und `aria-label`
  „Hilfe zu dieser Seite“, links vom Benutzermenü, in `EinsatzLayout` und `AppLayout`. Am Handy
  (Einsatzkopf mit einer Zeile, `frontend/AGENTS.md` „Stehenbleiben“) ist im Kopf kein Platz.
  Dort steht „Hilfe zu dieser Seite“ als Eintrag im Navigations-Drawer, neben Suche und
  Benutzermenü. *(Entscheidung beim Entwurf)* Im App-Rahmen bleibt der Knopf auch am Handy im
  Kopf, denn dort fällt unter `md` die Wortmarke weg. Passt er bei 360 px nicht, kommt er als
  Eintrag „Hilfe zu dieser Seite“ ins Benutzermenü. Das prüft der Bauende am Bild.
- **Benutzermenü:** Der Eintrag „Hilfe“ bleibt und öffnet weiterhin die volle Hilfe.

### 3. Tasten „?“ und F1

- Handler im Provider auf `window` `keydown`, mit derselben Vorprüfung wie die Palette
  (`defaultPrevented`, `repeat`, `isComposing`).
- „?“ heißt `e.key === '?'`. Auf deutscher Tastatur ist das Umschalt+ß, Umschalt ist also
  erlaubt. Strg, ⌘ und Alt dürfen nicht gedrückt sein. F1 heißt `e.key === 'F1'`, ohne
  Modifikator, und ruft `preventDefault`, weil der Browser sonst seine eigene Hilfe öffnet.
- Kein Auslösen, wenn das Ziel ein `input`, `textarea`, `select` oder `[contenteditable]` ist,
  wenn die Sprungpalette offen ist oder wenn ein Modal offen ist. *(Entscheidung beim Entwurf)*
  Als offenes Modal zählt ein sichtbares Element mit `[aria-modal="true"]` außerhalb der eigenen
  Leiste (antd-Modal und -Drawer setzen das). Popconfirm und Dropdowns zählen nicht, ihr Esc
  bleibt ihnen. F1 löst auch in Eingabefeldern
  aus: dort tippt niemand ein F1.
- Ist die Leiste offen, schaltet die Taste sie zu.
- Die Seite `/hilfe` hat diese Tasten nicht, sie ist selbst die Hilfe.

### 4. Tastenkürzel-Übersicht

- `hilfe/tastenkuerzel.ts` (ohne Kapiteltexte): eine Tabelle von Gruppen mit Einträgen
  `{ tasten(apple: boolean): string[]; wirkung: string }`.
  - **Überall:** Sprungpalette (Strg/⌘+K), Hilfe zu dieser Seite (?, F1). Dazu die Einträge aus
    `TASTATUR_AKTIONEN` (Speichern, Verwerfen, Filter zurücksetzen), die über
    `kuerzelFuerTastaturAktion` gezogen werden statt sie abzuschreiben.
  - **In der Sprungpalette:** ↵ öffnen, Strg/⌘+↵ im neuen Tab, → Vorschau, Esc zurück.
  - **In Listen:** „/“ springt ins Suchfeld (`KatalogTabelle`).
  - **Je Modul:** seiteneigene Kürzel. Die Gruppe der aktuellen Seite steht oben, mit dem
    Modulnamen als Überschrift. Gesammelt werden sie aus den `keydown`-Handlern der Module
    (Lagekarte, ETB, Schichtplan u. a.). Die Liste der Handler steht im Plan.
- Darstellung mit `Tastenkuerzel` (`components/Tastenkuerzel.tsx`), als Definitionsliste. Die
  Plattformweiche ist `istApplePlattform(navigator.userAgent)`.
- Ein Wächter-Test prüft, dass jedes Kürzel aus `TASTATUR_AKTIONEN` in der Tabelle steht.

### 5. Sprungpalette

- Zwei Zeilen in `baueBefehle` (`command-palette/befehle.ts`), Gruppe `navigation`, für jeden
  angemeldeten Benutzer und nicht auf dem gekoppelten Gerät:
  - `hilfe:seite` „Hilfe zu dieser Seite“, Schlagworte „hilfe“,
    „anleitung“, „doku“, „f1“, „?“. Sie ruft `oeffneHilfe('seite')`.
  - `hilfe:kuerzel` „Tastenkürzel“, Schlagworte „tasten“, „kürzel“, „shortcuts“, „tastatur“.
    Sie ruft `oeffneHilfe('kuerzel')` und fehlt bei Berührung.
- *(Entscheidung beim Entwurf)* Die Zeile zeigt keinen Kapiteltitel. Die Titel stehen nur in
  `hilfe/kapitel.ts`, das alle Texte lädt. Ein Titel in der Palette zöge also den Hilfe-Chunk in
  den Haupt-Chunk oder bräuchte eine zweite Quelle. Den Titel zeigt erst die Seitenleiste.
- Das sind Aktionen, keine Navigation, deshalb ohne `sprungZu`. `nav:hilfe` bleibt.
- `BefehlKontext` bekommt `oeffneHilfe?`. Fehlt es (auf `/hilfe`), fehlen die beiden Zeilen.
- Ob die Zeilen ins Palette-Gedächtnis kommen: Wahl des Bauenden, wie bei anderen Aktionen.

### 6. Willkommenskarte

- Neuer Schlüssel `willkommen_geschlossen` in `BEKANNTE_SCHLUESSEL`
  (`src/benutzer_einstellungen/mod.rs`). Der Wert ist der UTC-Zeitpunkt des Schließens als Text
  (ADR-0012). Er ist opak, wie `zuletzt_befehle`. Eine Migration braucht es nicht.
- `hilfe/WillkommenKarte.tsx` auf der Einsatzliste, über dem Neuigkeiten-Hinweis. Sie erscheint,
  solange der Schlüssel fehlt, und schließt sich über ein „×“ oder „Verstanden“, das den
  Schlüssel schreibt.
  - Text, unpersönlich nach der Festlegung der Anrede in LLH-1812: „Willkommen bei Lifeline Hub“.
    Drei kurze Zeilen: Aufbau (Einsatzliste → Einsatz → Module), „?“ öffnet die Hilfe zur Seite,
    Strg/⌘+K öffnet die Sprungpalette (bei Berührung: „die Suche im Menü“). Dazu der Link
    „Einweisung lesen“ zur Mappe der Gruppe „Alle“ (`hilfePfad({ gruppe: 'alle' })`).
    *(Entscheidung beim Entwurf)* Eine Gruppe ist ein Filter und kein Recht (`hilfe/gruppen.ts`).
    Eine Zuordnung Person → Gruppe gibt es nicht, und für eine Karte erfinden wir keine. Den
    genauen Wortlaut legt der Bauende fest.
  - Auch Bestandsnutzer sehen die Karte einmal. Das ist gewollt: sie erfahren so von „?“.
  - Steht gleichzeitig der Neuigkeiten-Hinweis da, stehen beide Karten untereinander,
    Willkommen zuerst.
  - Auf dem gekoppelten Gerät erscheint sie nicht.
  - Ist der Stand der Einstellungen nicht geladen oder fehlerhaft, erscheint sie nicht. Lieber
    keine Karte als eine, die nach dem Schließen wiederkommt.

### 7. Anwenderdoku und Regeln

- Kapitel `einsatz-oberflaeche`: ein Ablauf „Hilfe zur Seite öffnen“, die Kopfzeile nennt den
  Knopf „?“, ein Abschnitt „Tastenkürzel“ verweist auf den Reiter. Die neuen Pfade kommen in die
  `quellen`.
- `docs/anwender/AGENTS.md`, „Hilfe in der App“: die Zuordnungsregel aus Abschnitt 1, die
  Seitenleiste (eigener Chunk, Provider ohne Texte) und die Tasten.
- `frontend/AGENTS.md`, „UI-Form-Leitlinie“: die Hilfe-Seitenleiste als zweite Ausnahme.
- Bilder für die Doku (Bildlauf): Ob das Kapitel ein Bild der Seitenleiste bekommt, entscheidet
  der Bauende nach den Regeln in `docs/anwender/AGENTS.md`.

## Tests (Kurzfassung)

- `kontextKapitel`: Auflösung je Tabellenmuster, Modulpfad, Rückfall. Wächter wie oben.
- Provider: „?“ öffnet, „?“ im Eingabefeld nicht, F1 überall, `preventDefault` bei F1, nicht bei
  offener Palette oder offenem Modal, zweimal schaltet zu.
- Seitenleiste: zeigt das Kapitel der Route, wechselt mit der Route, kein Reiter „Tastenkürzel“
  bei Berührung, Esc gibt den Fokus zurück.
- Palette: beide Zeilen da und auslösend, `hilfe:kuerzel` fehlt bei Berührung, beide fehlen ohne
  `oeffneHilfe`.
- Willkommenskarte: sichtbar ohne Schlüssel, weg mit Schlüssel, Schließen schreibt, nicht auf
  dem Gerät, nicht bei unbekanntem Stand.
- Backend: Der Schlüssel ist gültig (Test neben `schnellaktionen_zaehler_ist_ein_gueltiger_…`).
- Chunk: Ein Test oder eine Prüfung belegt, dass `kontextKapitel.ts`, `tastenkuerzel.ts`,
  `befehle.ts` und der Provider `kapitel.ts` nicht importieren.

## Dem Bauenden überlassen

- Die Zuordnung je Modul und die vollständige Pfadtabelle, aus `App.tsx` und den `quellen`.
- Die Liste der seiteneigenen Kürzel, gesammelt aus den `keydown`-Handlern.
- Symbol und genaue Lage des „?“-Knopfs im Kopf, nach `Kopfleiste` und Gestaltungssprache.
- Der Wortlaut der Willkommenskarte im Rahmen von Abschnitt 6.

## Abhängigkeiten

- **LLH-1825** (Glossar, Legende) läuft parallel und ändert ebenfalls `hilfe/` und
  Doku-Kapitel. Mögliche Konflikte in `HilfePage.tsx` und `einsatz-oberflaeche.md` werden beim
  Merge mit `alpha` gelöst. Ein Glossar-Kapitel bekommt später sein Pfadmuster in der Tabelle.
- **LLH-1990** (anschauliche Einführung) baut auf der Willkommenskarte auf.
