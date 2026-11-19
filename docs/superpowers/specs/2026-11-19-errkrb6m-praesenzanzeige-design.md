# Präsenzanzeige „wird gerade bearbeitet von …“ (LLH-1946)

Zunder: https://zunder.rubeen.dev/#/aufgabe/errkrb6mxojuxpps7hljdbtt
Route `entwurf` (E1 Transport und Umfang, E2 neue Live-Regel, E3 Backend und Frontend).
Abgestimmt mit Ruben am 19.11.2026 (Phase-1-Checkpoint).

## Absicht

Feldvergleich (LLH-1831) und Änderungsvermerk (LLH-1834) fangen gleichzeitiges Bearbeiten ab,
**nachdem** es passiert ist: B sieht den Dialog „Zwischenzeitlich geändert“ erst beim Speichern.
Die Präsenzanzeige sagt es **vorher**: Öffnet A die Angabe „Leitstellen-Nr.“, sieht B an derselben
Angabe „Wird gerade bearbeitet von Anna“. B wartet oder spricht A an. Das ist nur ein Hinweis
und keine Sperre.

## Ziele

- Ein Hinweis an der einzelnen Angabe, solange jemand anderes sie offen hat. Er erscheint nach
  rund 1 s und verschwindet beim Schließen sofort, spätestens 45 s nach dem letzten Lebenszeichen
  (Tab zu, Netz weg, Absturz).
- Er gilt für die Angaben, die schon den Änderungsvermerk tragen: Einsatzdaten/Einsatzkopf
  (`einsatz`), eigene Führungsstelle (`fuehrungsstelle`) und Einheit (`einheit`). Die Feldnamen
  sind dieselben Wire-Namen wie beim Vermerk.
- Dasselbe Konto in einem anderen Fenster oder auf einem anderen Gerät erscheint als „Wird gerade
  von dir in einem anderen Fenster bearbeitet“.

## Nicht-Ziele

- Keine Sperre und kein Vorrang. Speichern bleibt für alle offen, der Feldvergleich bleibt das
  Netz.
- Keine weiteren Objekte (Abschnitt, Disposition, Person, Betreuung …) und keine
  `BearbeitbaresPaneel`-Stellen ohne Einsatz (Planung, Anbindungen). Weitere Objekte kommen
  später schrittweise auf denselben Baustein.
- Kein Hinweis „X ist auf dieser Seite“ (Seitenpräsenz), keine Avatare und keine Cursor.
- Keine Persistenz, kein ETB-Eintrag, kein Protokoll und keine Spiegelung über Instanzen
  (Spiegel). Präsenz lebt nur im Speicher des Prozesses.
- Nicht in der öffentlichen API v1.

## Anti-Ziele (was ein Fehlschlag wäre, auch wenn es technisch läuft)

- Präsenz verdrängt echte Ereignisse aus dem Replay-Ring, und Clients fallen öfter in `lagged`
  und den Vollabgleich.
- Ein Hinweis bleibt stehen, obwohl niemand mehr bearbeitet. Er „klebt“ länger als 45 s.
- Ein Leser ohne Modul `einheiten` erfährt über Präsenz, dass eine Einheit existiert oder dass
  dort gearbeitet wird (Metadaten-Leak am Gate vorbei).
- Ein Gerät (Gerätekonto) sendet Präsenz oder bekommt sie.
- Der Hinweis springt unter dem Cursor oder blinkt (`frontend/AGENTS.md`, „Live-Updates springen
  nicht unter dem Cursor“).

## Rahmen (Befund)

- `LiveHub` (`src/live/mod.rs`) hat je Einsatz einen `broadcast` mit Replay-Ring 256 und
  Nachrichten-Ids. Vorbild für Ereignisse ohne `id:` und ohne Replay ist der Org-Anteil, den
  `routes/live.rs::stream` schon in den Einsatzstrom mischt (`einsatz_strom.merge(org_strom)`,
  LFH-734 D4). Präsenz wird ein dritter Teilstrom in diesem `merge`.
- `LiveEvent::modul_keys()` gatet je **Variante**. Präsenz braucht ein Gate je **Objekt**: Einsatz
  und Führungsstelle sind so offen wie `LiveEvent::Einsatz` (`&[]`), eine Einheit so offen wie
  `LiveEvent::Einheit` (`einheiten`, `lagekarte`, `verpflegung`).
- Gates der Schreibwege: `PATCH /api/einsaetze/{id}` und `PATCH …/fuehrungsstelle` nehmen
  `EinsatzVerwaltungszugriff`, `PATCH …/einheiten/{eid}` nimmt `EinsatzSchreibzugriff<Einheiten>`.
- Gerätekonten: Der Server ist die Schranke. Eine Route, die in der Liste der Funktionsansicht
  (`src/geraet/mod.rs`) fehlt, ist verboten. Ein Gerätestrom bekommt keinen Org-Anteil.
- Spiegel: Dort öffnet kein Editor (`darfSchreiben` ist `false`), Präsenz entfällt also von selbst.
- Frontend: `InlineAngabe` hat `onOeffnen` und `onSchliessen`, aber keine Objektkennung. Der
  Vermerk kommt als `vermerk` herein, `VermerkZeile` zeigt ihn leise unter dem Wert
  (`components/FeldVermerkAnzeige.tsx`).
- `benachrichtigung` ist im Frontend ein Ereignis außerhalb der Cache-Registry (`NICHT_REGISTRY`
  im Kontrakttest) mit eigenem Empfänger. Präsenz folgt diesem Muster **nur im Frontend**; im
  Backend läuft `benachrichtigung` durch den Ring, Präsenz nicht.

## Ansätze

1. **Eigener Präsenz-Broadcast im Einsatzstrom, am Ring vorbei, mit Gate je Eintrag.**
   *Gewählt.* Es werden nur Änderungen verteilt, nicht jeder Herzschlag. Ein neuer Strom bekommt
   beim Verbinden den aktuellen Stand. Der Ring bleibt unberührt, und der Wire-Name bleibt Teil
   des Enum-Vertrags.
2. **Normale `LiveEvent`-Variante im Ring.** Das ist die kleinste Erweiterung, aber jedes Öffnen,
   Schließen und Ablaufen belegt einen Ringplatz. Bei vielen Bearbeitern drohen Lücken und
   Vollabgleich. Verworfen.
3. **Abfrage statt Live.** Der Client fragt alle ~10 s. Das bringt mehr Last und mehr Verzögerung,
   und das Ablaufen wäre trotzdem nötig. Verworfen.

Umfang „je Feld an drei Objekten“ statt „alle 48 Angaben“ oder „je Seite“: Der Schlüssel
`(objekt, einheit_id, feld)` und die Feldlisten gibt es nur für diese drei schon. Die Seitenpräsenz
wäre zu ungenau, um Kollisionen an einer Angabe zu vermeiden.

## Entscheidungen

### D1 Schlüssel und Wire-Form

Ein Präsenz-Eintrag hat:

- `objekt`: neues `wire_enum!` `PraesenzObjekt` mit `einsatz | einheit | fuehrungsstelle`
  (ADR-0006, Wire-Kontrakt in `tests/enum_wire_kontrakt.rs`). Die Werte gleichen `objekt_art` des
  Vermerks.
- `einheit_id`: nur bei `einheit`.
- `felder`: 1 bis 4 Wire-Feldnamen aus der **festen Liste** des Objekts (Vermerk-Feldnamen). Eine
  Liste, weil eine Eingabe mehrere Angaben bearbeiten kann: Die Einsatzort-Adresse bearbeitet die
  Koordinate mit, `StandortAngabe` trägt Adresse und Koordinate. Eine Zeile zeigt den Hinweis, wenn
  ihr Feld in `felder` eines fremden Eintrags steht. Ein unbekanntes Feld, eine leere oder zu lange
  Liste ergibt 400 (`src/AGENTS.md`, Statuscodes). Die Präsenz-Feldliste je Objekt entsteht als
  Konstante neben `feld_vermerk`; sie enthält nur Felder, die der PATCH des Objekts schreibt, nicht
  die Felder, die andere Wege setzen (Disposition, `mitglied_repo`). *Meine Wahl (Builder-Check):
  Liste statt eines Leitfelds, damit B an „Koordinate“ sieht, dass A die Adresse bearbeitet.*
- `benutzer_id`, `von` (Anzeigename, wie `FeldVermerk.von`) und `fenster` (zufällige Kennung des
  Tabs, vom Client erzeugt, höchstens 64 Zeichen `[A-Za-z0-9_-]`).

Ereignis auf dem Einsatzstrom, Wire-Name `praesenz`, Daten:
`{"einsatz_id":…, "eintraege":[{objekt, einheit_id?, felder, benutzer_id, von, fenster}]}`, immer der
**ganze** sichtbare Stand des Einsatzes für diese Verbindung. Volle Liste statt Delta: kein
Reihenfolgeproblem, kein Nachreichen, und die Liste ist klein (Grenzen unter D3).

### D2 Gate und Verteilung

- `LiveEvent::Praesenz` kommt ins Enum, damit der Wire-Name im Vertrag steht. Im Frontend kommt es
  in `NICHT_REGISTRY` wie `benachrichtigung`. `modul_keys()` ist `&[]`. Der Wächtertest
  `ungegatet_sind_nur_…` wird bewusst um `praesenz` erweitert, mit Kommentar: Das Gate greift je
  Eintrag, nicht je Variante.
- **Gate je Eintrag:** Ein Eintrag mit `objekt = einheit` ist für eine Verbindung sichtbar, wenn
  sie `LiveEvent::Einheit` sehen darf (gleiche Menge `erlaubt`, `sichtbar_fuer`). `einsatz` und
  `fuehrungsstelle` sind sichtbar wie `LiveEvent::Einsatz`. Ein Bezugsereignis je Objekt
  (`PraesenzObjekt::bezug() -> LiveEvent`) verhindert, dass die Gate-Mengen auseinanderlaufen.
- **Am Ring vorbei:** Der Hub hält einen eigenen `broadcast::Sender<PraesenzStand>` (Einsatz-Id und
  alle Einträge). Der Einsatzstrom (`routes/live.rs::stream`) mischt ihn zusätzlich ein, filtert je
  Verbindung und sendet ein SSE-Ereignis **ohne `id:`**. Die `Last-Event-ID` bleibt unberührt,
  einen Replay gibt es nicht.
- **Stand beim Verbinden:** Gleich nach der `position` bekommt jeder neue Strom den aktuellen
  gefilterten Stand. Bei leerem Stand wird nichts gesendet.
- **Geräte:** Ein Gerätestrom mischt den Präsenz-Broadcast nicht ein (wie den Org-Anteil).
- **Org-Strom:** Er bekommt keine Präsenz. Präsenz ist einsatzbezogen (`src/AGENTS.md`,
  Org-Ereignisse).
- Verteilt wird nur, wenn sich der Stand eines Einsatzes ändert: neuer Eintrag, entfernter Eintrag,
  abgelaufener Eintrag. Ein Herzschlag, der nur die Ablaufzeit verlängert, verteilt nichts.

### D3 Zustand im Speicher, Ablauf und Grenzen

- Der Zustand liegt im `LiveHub` (ein neues `AppState`-Feld bräche jede Testkonstruktion):
  `Mutex<HashMap<einsatz_id, Vec<Eintrag>>>` oder gleichwertig. Ein Eintrag ist eindeutig über
  `(benutzer_id, fenster)`; er trägt `objekt`, `einheit_id` und `felder`.
- Ein Fenster hat höchstens **einen** Eintrag. Öffnet es eine andere Angabe, ersetzt sie den alten
  Eintrag, denn je Seite ist ohnehin nur eine Bearbeitung offen (`frontend/AGENTS.md`, offene
  Bearbeitung).
- **Ablauf 45 s** nach dem letzten Lebenszeichen. Der Client meldet sich alle 15 s. Ein Aufräumtakt
  (alle ~5 s, als Task im Hub oder neben dem bestehenden Kanal-Sweep) entfernt Abgelaufenes und
  verteilt danach. Die Zeit wird für Tests hineingereicht (Muster `BegrenzterAblaufSpeicher`).
- **Grenzen:** höchstens 16 Einträge je Benutzer (wie die Stromgrenze je Benutzer; darüber 429)
  und höchstens 2 000 insgesamt (darüber 503). Kein Verdrängen, Muster `ablauf_speicher.rs`. Ein
  neuer Benutzer verdrängt also nie fremde Einträge.
- **Neustart:** Der Zustand ist weg. Die Clients melden sich binnen 15 s wieder.

### D4 Schreibwege

- `PUT /api/einsaetze/{id}/praesenz` für `einsatz` und `fuehrungsstelle`, Gate
  `EinsatzVerwaltungszugriff` (wie deren PATCH). Body `{objekt, felder, fenster}`.
- `PUT /api/einsaetze/{id}/einheiten/{eid}/praesenz` für `einheit`, Gate
  `EinsatzSchreibzugriff<Einheiten>` (wie deren PATCH). Body `{felder, fenster}`. Eine Einheit, die
  nicht zum Einsatz gehört, ergibt 404.
- `PUT` beginnt oder verlängert. Die Antwort ist 204.
- `DELETE` auf denselben Pfaden mit `{fenster}` beendet den Eintrag dieses Fensters. Die Antwort
  ist 204, auch wenn nichts da war (idempotent).
- Es gibt zwei Routen statt einer, weil jeder Handler genau einen Gate-Typ trägt (ADR-0005) und die
  Einheit das Modulrecht braucht.
- Inaktiver oder abgeschlossener Einsatz: dieselbe Ablehnung wie der PATCH daneben. Spiegel: Der
  Schreibweg wird abgelehnt, wenn der PATCH daneben es auch wird. Sonst prüft der Builder es nach
  der Spiegel-Regel in `src/AGENTS.md`.
- Gerätekonten: Die Routen stehen in keiner Routenliste von `src/geraet/mod.rs` und sind damit
  verboten. Ein Test in `tests/geraet_kopplung.rs` hält das fest.
- Nur über `JsonBody` und `PfadParam`. Request-DTOs werden von Hand gepflegt, und Typ-Codegen läuft
  für das neue Enum und das Ereignis-DTO (`scripts/check-typ-codegen.sh`).

### D5 Client

- **Fensterkennung:** einmal je Tab erzeugt (`crypto.randomUUID`) und im Speicher gehalten. Sie
  wird nicht gespeichert, ein Neuladen ergibt ein neues Fenster.
- **Senden:** Neue optionale Prop `praesenz?: { objekt, einheitId?, felder }` an `InlineAngabe`.
  Solange die Eingabe offen ist, gilt: beim Öffnen `PUT`, danach alle 15 s `PUT`, beim Schließen
  (auch Aushängen und Sperre) `DELETE`. Ein `pagehide` sendet das `DELETE` mit `keepalive`. Dafür
  bekommt `api/client.ts` einen neuen Helfer: `apiSend` kennt kein `keepalive`, und
  `apiSendKeepalive` kann nur POST und prüft den Erwarteter-Benutzer-Kopf nicht. Der Helfer schickt
  den Kopf mit, und `schreibwege.guard.test.ts` deckt ihn ab. Ohne
  Netz (`useOhneVerbindung`) wird nichts gesendet und nichts in die Warteschlange gelegt; der
  Server lässt den Eintrag ablaufen (ADR-0008). Fehler der Präsenzaufrufe werden still verworfen,
  ohne Meldung an der Zeile.
- Gesendet wird über `apiSend` (Erwarteter-Benutzer-Kopf). Ein 412 beendet die Präsenz; die
  allgemeine Benutzerprüfung (`BENUTZER_PRUEFEN`), die `apiSend` dabei immer auslöst, bleibt.
- **Empfangen:** Ein Listener für `praesenz` in `live/` (Muster `benachrichtigungListener`) legt den
  Stand in einen kleinen Store je Einsatz (`useSyncExternalStore`), nicht in den Query-Cache und
  nicht als Query-Key. Ein Abbruch des Stroms leert den Stand des Einsatzes. Nach dem Neuaufbau
  kommt der Stand beim Verbinden.
- **Lesen:** Der Hook `usePraesenz(einsatzId, schluessel)` liefert die fremden Bearbeiter dieser
  Angabe. Das eigene Fenster ist ausgenommen. Dasselbe Konto in einem anderen Fenster wird als
  „du“ markiert.

### D6 Anzeige

- Schrift: Rolle `meta`, Farbrolle `text` (nicht `gedaempft` wie der Vermerk, nicht `achtung`).
  Keine neue Farbrolle, kein Symbol, das blinkt. *Meine Wahl (Builder-Check): Es gibt keine
  Hinweis-Rolle; `text` hebt den Hinweis vom gedämpften Vermerk ab, ohne zu warnen.*
- Wortlaut:
  - eine fremde Person: „Wird gerade bearbeitet von Anna“
  - mehrere: „Wird gerade bearbeitet von Anna und Ben“, ab drei „von Anna und 2 weiteren“
  - eigenes Konto anderswo: „Wird gerade von dir in einem anderen Fenster bearbeitet“
  - beides: „Wird gerade bearbeitet von Anna und von dir in einem anderen Fenster“
- **Platz: statt des Vermerks** (entschieden von Ruben, 19.11.2026). Solange jemand anderes die
  Angabe bearbeitet, nimmt der Hinweis die Zeile von „Geändert von …“ ein; danach kehrt der Vermerk
  zurück. So springt in der Regel nichts. Hat die Angabe noch keinen Vermerk, kommt eine Zeile
  dazu. Das ist eine zweite, festgeschriebene Ausnahme von „Live-Updates springen nicht unter dem
  Cursor“ neben der Alarmzone; sie wird in `frontend/AGENTS.md` an dieser Regel ergänzt. Im offenen
  Feld steht er neben dem bestehenden „Inzwischen geändert von …“, unter der Eingabe und nie in
  ihr.
- Der Hinweis reserviert keinen Platz, solange er fehlt.
- `data-lfh="feld-praesenz"` für Tests und Bildlauf. Barrierefreiheit: Der Text hängt über
  `aria-describedby` am Wertknopf. Er ist keine Live-Region, damit Screenreader ihn nicht bei
  jedem Wechsel ansagen.
- Ein Paneelkopf-Hinweis („jemand bearbeitet in diesem Paneel“) entfällt in diesem Schritt.

### D7 Aufrufstellen

`praesenz` bekommen die Angaben, die heute `vermerk` tragen: `pages/EinsatzdatenPage.tsx`
(Einsatzkopf, Einsatzort, Koordinate, Führungsstelle), `pages/einheit/EinheitKopf.tsx`,
`pages/einheit/EinheitFunk.tsx` und `pages/EinsatzleiterAngabe.tsx`, soweit sie dort für diese drei
Objekte über `InlineAngabe` laufen. `StandortAngabe` bekommt die Prop, wenn sie über `InlineAngabe`
läuft. Zusammengesetzte Eingaben mit eigenem Editor ohne `InlineAngabe` (Verbindungen über
`VerbindungenFeld`, Führungsfahrzeuge `fahrzeug_ids`) bleiben in diesem Schritt ohne Präsenz.
Angaben ohne `vermerk` bleiben ebenfalls ohne. *Meine Wahl (Builder-Check): Die Prop bleibt an
einem Baustein, damit Takt und Abmelden nur an einer Stelle leben.*

### D8 Regeln und Doku

- Eine neue Regel in `src/AGENTS.md` (Abschnitt „ETB live verteilen“ bzw. Live): flüchtiger Zustand
  wie Präsenz läuft am Replay-Ring vorbei, mit Gate je Eintrag über ein Bezugsereignis, nie im
  Org-Strom und nie an Geräte. Die Frontend-Regel (Store außerhalb des Query-Caches, kein
  Query-Key) steht in `frontend/AGENTS.md` beim Live-Abschnitt.
- Architektur: Der Builder prüft nach `docs/architektur/AGENTS.md`, ob ADR-0003/0064 eine
  Fortschreibung oder eine neue ADR brauchen (neue Ereignisart „flüchtig, ohne Id“). Die
  Mitänderungsregel der arc42-Kapitel gilt.
- Anwender: Der Hinweis gehört in das Kapitel zu Einsatzdaten bzw. Einheit (Mitänderungsregel in
  `docs/anwender/AGENTS.md`), als ein Satz mit Wortlaut.

## Tests (Mindestumfang)

- Backend-Einheit: Ablauf nach 45 s mit hineingereichter Zeit, ein Eintrag je Fenster, Grenzen
  429/503, Verteilen nur bei Änderung, Gate je Eintrag (ohne `einheiten` keine Einheit-Einträge,
  aber Einsatz-Einträge).
- Integration: `PUT`/`DELETE` mit Gates (fremder Einsatz 404, ohne Recht 403, unbekanntes Feld
  400, fremde Einheit 404), Gerät 403, Strom bekommt den Stand beim Verbinden und keinen
  Präsenzrahmen mit `id:`.
- Kontrakte: `live_event_wire`, `liveEvent.contract.test.ts` (`NICHT_REGISTRY` um `praesenz`),
  Wire-Kontrakt des neuen Enums, Gate-Pins.
- Frontend: Hook und Store (eigenes Fenster ausgenommen, „du“ erkannt, Leeren beim Abbruch), Takt
  von `InlineAngabe` (PUT bei Öffnen, alle 15 s, DELETE bei Schließen, nichts ohne Netz) mit
  Fake-Timern, Wortlaute.
- e2e: zwei Kontexte, A öffnet „Leitstellen-Nr.“, B sieht den Hinweis, A schließt, der Hinweis
  verschwindet.

## Dem Builder überlassen

- Genaue Struktur des Speichers und des Aufräumtakts, solange D3 gilt.
- Name und Ort des Stores und des Hooks in `frontend/src/live/` bzw. `components/`.
- Ob die feste Feldliste je Objekt schon existiert oder hier entsteht.
- Feinheiten der Typografie innerhalb der Gestaltungssprache.
