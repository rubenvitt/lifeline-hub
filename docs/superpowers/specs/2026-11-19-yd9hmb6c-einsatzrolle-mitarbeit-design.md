# Vierte Einsatzrolle „Mitarbeit“ — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/yd9hmb6c5q32st2ddrz7gybq (LLH-1817)
Stand: 19.11.2026 · Route `entwurf` (E1 Entscheidung, E2 neue Regel, E3 Backend + Frontend + Instanzkopplung)

## Warum

Heute gibt es drei Einsatzrollen: Einsatzleitung, Führungspersonal und Beobachter. Der Beobachter
darf nichts schreiben, also auch keinen Chat und keine Meldung. Wer im Einsatz nur melden,
mitschreiben oder ein Foto hochladen soll (Melder an der Einsatzstelle, Funker, Schreibkraft im
ETB), braucht deshalb heute die Rolle Führungspersonal und damit Vollzugriff auf Kräfte,
Abschnitte, Aufträge und Einstellungen. Die neue Rolle schließt diese Lücke.

**Erfolg:** Eine Einsatzleitung kann jemanden als „Mitarbeit“ in den Einsatz holen. Diese Person
kann Meldungen erfassen, im Chat schreiben, ETB-Einträge anlegen und eigene Fotos anhängen,
offline wie online und auch an einem Spiegel. Alles andere sieht sie nur so, wie ein Beobachter
es sieht.

## Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- Neue Rolle `EinsatzRolle::Mitarbeit`, Wire `mitarbeit`, Anzeigename „Mitarbeit“.
- Sie darf genau die Erfassungen in der Positivliste unten, sonst nichts.
- Lesen wie Beobachter.
- Gekoppelte Instanzen mit älterem Stand bleiben voll gekoppelt.

**Nicht-Ziele**
- Keine frei konfigurierbare Rechte-Matrix.
- Keine Änderung an der öffentlichen API v1 (sie kennt keine Einsatzrollen).
- Das Rollen-Vokabular mit Darf-Sätzen ist LLH-1818. Diese Aufgabe liefert nur den Namen und
  einen Satz für die neue Rolle dort, wo heute Rollennamen stehen.

**Anti-Ziele** (Fehlschlag, auch wenn es technisch läuft)
- Ein Schreibweg, der heute Führungspersonal vorbehalten ist, steht der Mitarbeit offen, weil er
  vergessen wurde. Deshalb Positivliste statt Sperrliste.
- Mitarbeit gehört zur Modulstufe „Führung im Einsatz“ oder bekommt Führungs-Benachrichtigungen.
- Eine ältere gekoppelte Instanz bricht den Abgleich ab, weil sie den Wert `mitarbeit` nicht kennt.

## Ansätze

| Ansatz | Kurz | Bewertung |
|---|---|---|
| **A Positivliste (gewählt)** | `darf_schreiben()` bleibt für Mitarbeit `false`. Ein neues Gate `EinsatzErfassungszugriff<M>` lässt Einsatzleitung, Führungspersonal **und** Mitarbeit durch und steht nur an den Handlern der Liste. | Jeder heutige und künftige Schreibweg bleibt der Mitarbeit zu, solange niemand ihn bewusst freigibt. Neun Handler werden umgestellt. |
| B Sperrliste | Mitarbeit bekommt `darf_schreiben()`, Kräfte, Abschnitte, Einstellungen usw. werden einzeln gesperrt. | Weniger Umbau, aber über 250 Schreibwege stünden offen und jeder neue Weg auch. Verworfen. |
| C Merkmal am Beobachter | Beobachter mit Zusatzschalter „darf erfassen“. | Zwei Achsen für eine Rolle, unklar in Anzeige und Kopplung. Verworfen. |
| D Rechte-Matrix | Je Rolle und Modul konfigurierbar. | Weit über dem Bedarf, hoher Prüfaufwand. Verworfen. |

Am 19.11.2026 entschieden: A, Name „Mitarbeit“, Umfang wie unten, Kopplung per Herabstufen,
keine Lagemeldungen durch Mitarbeit. Mit *Eigene Festlegung* markierte Punkte hat der Entwurf
entschieden; sie stehen zur Prüfung.

## Entscheidungen

### D1 Rolle und Prädikate (`src/einsatz/mod.rs`)

- `EinsatzRolle::Mitarbeit => "mitarbeit"`.
- `darf_schreiben()`: unverändert, Mitarbeit **false**.
- `gehoert_zur_fuehrung()`: Mitarbeit **false**. Sperrt eine Einsatzleitung ein Modul auf
  „Führung im Einsatz“, ist es auch für die Mitarbeit zu.
- Neu `darf_erfassen()`: Einsatzleitung, Führungspersonal, Mitarbeit.
- Neu `ist_mitarbeit()` für die Eigen-Prüfungen in D4.
- Alle `match`-Stellen über `EinsatzRolle` (Anzeige, Sortierung, Tests) bekommen den neuen Arm;
  der Compiler zeigt sie.

### D2 Gate `EinsatzErfassungszugriff<M>` und `EinsatzErfassungsfreigabe<M>` (`src/einsatz/kontext.rs`)

Zwei neue Gate-Typen, Spiegelbild von `EinsatzSchreibzugriff`/`EinsatzSchreibfreigabe`, nur mit
`fordere_erfassungsrecht` (`darf_erfassen()`) statt `fordere_schreibrecht`. Reihenfolge gleich:
Org-Floor → Erfassungsrecht → Modul-Gate → `fordere_aktiv` (bzw. `fordere_lesezugriff` bei der
Freigabe-Variante für idempotente Offline-Replays). Beide kommen in `SANKTIONIERTE_GATES`
(`tests/einsatz_kontext_guard.rs`) mit Kommentar `LLH-1817`; ADR-0005 bekommt eine Zeile.

Neue Funktion `fordere_erfassungsrecht(rolle)` in `src/einsatz/berechtigung.rs`. Gekoppelte
Geräte: Ihr Weg ändert sich nicht (sie tragen heute eine Rolle mit Schreibrecht, D-Tests in
`src/geraet/mod.rs` bleiben grün).

### D3 Positivliste

Diese Handler wechseln vom Schreib- auf das Erfassungs-Gate. Sonst ändert sich kein Handler.

| Handler | Route | Gate neu | Zusatz für Mitarbeit |
|---|---|---|---|
| `meldung::anlegen` | POST `/meldungen` | `EinsatzErfassungsfreigabe<Meldungen>` | `meldungsart = lagemeldung` → 403 (sie setzt implizit `lagerelevant`, `src/meldung/korrektur.rs`); `lat`/`lon` erlaubt |
| `meldung_korrektur::korrigieren` | PATCH `/meldungen/{mid}` | `EinsatzErfassungszugriff<Meldungen>` | nur eigene Meldung (`erfasst_von_id`), sonst 404; `lagerelevant` setzen, `lage_text` ändern oder `meldungsart` auf `lagemeldung` stellen → 403 |
| `chat::nachricht_erfassen` | POST `/chat/…/nachrichten` | `EinsatzErfassungszugriff<Chat>` | — |
| `chat::nachricht_bearbeiten` | PATCH `/chat/nachrichten/{mid}` | `EinsatzErfassungszugriff<Chat>` | prüft schon heute Autorschaft |
| `chat::nachricht_loeschen` | DELETE `/chat/nachrichten/{mid}` | `EinsatzErfassungszugriff<Chat>` | prüft schon heute Autorschaft |
| `etb::erfassen` | POST `/etb` | `EinsatzErfassungsfreigabe<Etb>` | Typ nur `meldung`, `lage`, `berichtigung`; Berichtigung nur eines eigenen Eintrags (`erfasser_id`), sonst 403; jeder Eintrag in `anhang_ids` muss von ihr hochgeladen sein, sonst 403 |
| `etb::anhang_hochladen` | POST `/etb/anhaenge` | `EinsatzErfassungszugriff<Etb>` | — (Upload vor dem Eintrag; die Bindung prüft `etb::erfassen`) |
| `anhang::hochladen` | POST `/anhaenge` | `EinsatzErfassungszugriff` | — |
| `anhang::loeschen` | DELETE `/anhaenge/{aid}` | `EinsatzErfassungszugriff` | prüft schon heute „nur wer hochgeladen hat“ bei ungebundenen Anhängen; modulgebundene 422 wie heute |

Bewusst **zu** für Mitarbeit (bleiben auf dem Schreib-Gate): Chat-Kanal anlegen, Bezug setzen und
löschen, Heraufstufen (beide Wege), Meldung Status/Bestätigen/Zuweisen/Lagerelevant/Auftrag,
Lage gesehen, ETB-Auftrag, sowie alle übrigen Module.

Rückgabe-Codes folgen `src/AGENTS.md`, „Statuscode-Konvention“: fremdes Objekt 404, verbotene
Handlung am eigenen Objekt 403.

### D4 Eigen-Prüfungen

Die Zusätze aus D3 stehen im Handler, direkt nach dem Gate, als eine Hilfsfunktion je Modul
(`fordere_eigene_meldung`, `fordere_etb_typ_fuer_rolle`). Für Einsatzleitung und Führungspersonal
ändert sich nichts.

### D5 Lesen, Module, Benachrichtigungen

- Lesen: wie Beobachter, ohne Änderung (Lese-Gate prüft nur Mitgliedschaft).
- Modul-Freigabe: Stufe `einsatzfuehrung` schließt Mitarbeit aus (`gehoert_zur_fuehrung`).
- Benachrichtigungen (`src/benachrichtigung/aufloesung.rs`) filtern über `darf_schreiben()` und
  schließen Mitarbeit damit aus. Kein Hinweis „Neue Meldung“ an die Mitarbeit.

### D6 Datenbank

`einsatz_mitgliedschaft.einsatz_rolle` hat einen CHECK (`migrations/0003_einsatz.sql`). Neue
Migration mit Tabellenumbau nach `migrations/AGENTS.md` („Tabellenumbau“, ohne
`-- no-transaction`); CHECK um `'mitarbeit'` erweitert. Alle sechs Trigger aus `0314_einsatz_spiegel.sql` (`einsatz_mitgliedschaft_spiegellog_{i,u,d}`
und `…_spiegelschutz_{i,u,d}`), alle übrigen Trigger, der Index `idx_mitgliedschaft_benutzer`
und die Spalten aus 0100 und 0128 werden übernommen bzw. neu angelegt; der Plan listet sie aus
dem aktuellen Schema (`sqlite_master`). Nummer per Vergabe-Skript.

### D7 Instanzkopplung: Herabstufen für ältere Gegenüber

Ältere Instanzen lehnen `mitarbeit` an ihrem CHECK ab, der Abgleich bräche. Kein Protokoll-Bump
(ein Sprung auf 5 würfe Instanzen mit Protokoll 3 aus dem vollen Fenster). Stattdessen eine
**Fähigkeit** wie `hinweise`/`web_push` (`src/instanz/melden.rs`, `repo::save_faehigkeiten`):

- Neues Fähigkeitsfeld `rolle_mitarbeit: bool` (`#[serde(default)]`, fehlt bei alten Ständen =
  `false`), neue Spalte `instanz_kopplung.gegenueber_rolle_mitarbeit` (in derselben oder einer
  zweiten Migration). *Eigene Festlegung:* Anders als `hinweise`/`web_push`, die nur die
  erreichte Seite in ihrer Antwort nennt, melden **beide** Seiten die Fähigkeit: die meldende in
  ihrer Anfrage, die erreichte in ihrer Antwort. Spiegelzeilen fließen in beide Richtungen
  (`handle_abgleich` und `abgleich_einmal` in `src/instanz/spiegel/abgleich.rs`), also muss jede
  Seite das Gegenüber kennen. Eine Spalte genügt, denn jede Seite speichert, was das Gegenüber
  gemeldet hat.
- Beim Senden einer Zeile `einsatz_mitgliedschaft` an ein Gegenüber ohne die Fähigkeit wird
  `mitarbeit` als `beobachter` gesendet. Dort kann die Person dann nur lesen und beantragen
  nicht; das ist der gewählte, sichere Weg.
- Empfangen: eine neue Instanz übernimmt `mitarbeit` unverändert. *Eigene Festlegung:* Kommt
  von einem Gegenüber **ohne** die Fähigkeit `beobachter` für eine Mitgliedschaft, die hier
  `mitarbeit` ist (Rückfluss nach Notübernahme oder Rückgabe), bleibt `mitarbeit` stehen. So
  stuft ein älterer Stand die Rolle nicht dauerhaft herab.
- Spiegel-Antrag (`src/instanz/spiegel/antrag.rs:476`): `fordere_schreibrecht` wird je
  beantragter Route zur Regel der Route. Für die Routen, die in D3 auf das Erfassungs-Gate gehen
  (ETB, Meldungen), gilt `fordere_erfassungsrecht`, für alle anderen beantragbaren Routen
  (Personen, Sichtung …) bleibt `fordere_schreibrecht`. Die Eigen-Prüfungen aus D4 laufen an der
  führenden Instanz, wenn sie den Antrag ausführt, über denselben Handler.
- Am Spiegel bleibt alles, was heute nicht beantragbar ist (Chat, Korrektur, Anhänge), für jede
  Rolle zu, auch für die Mitarbeit. „Offline und Spiegel“ heißt: dieselben Wege wie bei
  Führungspersonal, nicht mehr. *Eigene Festlegung.*
- `darfNachreichenVerwerfen` (nicht übernommene Einträge nach Notübernahme verwerfen): bleibt
  bei Einsatzleitung und Führungspersonal. *Eigene Festlegung:* Ein Eingriff in den Abgleich ist
  keine Erfassung.

### D8 Wire und Codegen

`EinsatzRolle` ist ein Response-Enum: `scripts/check-typ-codegen.sh`, beide generierten Dateien
mitcommitten (`src/AGENTS.md`, „Typ-Codegen“), `tests/enum_wire_kontrakt.rs` um den Wert
ergänzen.

### D9 Frontend

- `frontend/src/einsatz/schreibrecht.ts`: neue Funktion `darfImEinsatzErfassen(einsatz, benutzer)`
  mit Norm `aktiv && !spiegel && (EL || FüPers || Mitarbeit)`; `istMitarbeit`. Am Spiegel lässt
  `darfBeantragen` heute nur EL und FüPers zu und gilt für alle beantragbaren Routen. Neu
  `darfErfassungBeantragen` (EL, FüPers, Mitarbeit), nur an ETB- und Meldungserfassung;
  `darfBeantragen` bleibt für Personen, Sichtung usw. unverändert. Der Guard-Test
  (`schreibrecht.guard.test.ts`) bleibt: keine rohen `meine_rolle`-Vergleiche woanders.
- Umstellen von `darfImEinsatzSchreiben` auf `darfImEinsatzErfassen` genau an den Erfassungen:
  Meldung erfassen, Chat-Eingabe und eigene Nachricht bearbeiten/löschen, ETB-Erfassung
  (Typauswahl für Mitarbeit auf Meldung/Lage, Berichtigen nur an eigenen Einträgen; Meldungsart
  ohne „Lagemeldung“, kein Lagerelevant-Schalter),
  Erfassungs-Anhänge (`components/erfassungsAnhaenge`), Offline-Warteschlange für diese Wege.
  Meldung korrigieren nur an eigenen Meldungen.
- Rollenwahl in der Mitgliederverwaltung: neue Option „Mitarbeit“ zwischen Führungspersonal und
  Beobachter mit dem Satz „Erfasst Meldungen, Chat und ETB-Einträge, ändert sonst nichts.“ Die
  Rollennamen liegen heute verteilt (`einsatzRolle.ts`, `optionen.ts`,
  `stammdaten/rechteText.ts`, `components/nurAnsicht.ts`); jede dieser Stellen bekommt den
  Wert. Die Zusammenführung bleibt LLH-1818.
- Die Kopfzeile „Nur Ansicht“ bzw. der Rechte-Grund (`einsatzRechteGrund`) nennt für Mitarbeit
  „als Mitarbeit nur erfassen“ (Wortlaut seit LLH-1818, `NUR_ERFASSEN` in
  `components/nurAnsicht.ts`; nachgezogen mit LLH-2008).

### D10 Doku und Regeln

- Anwenderdoku `rechte-im-einsatz.md` (und `benutzer.md`, falls dort Rollen stehen): neue Rolle
  mit Darf-Satz, nach `docs/anwender/AGENTS.md`.
- `src/AGENTS.md`: kurzer Abschnitt „Erfassungs-Gate (LLH-1817)“: wann ein Handler das
  Erfassungs- statt das Schreib-Gate trägt (nur durch bewusste Entscheidung, Liste in diesem
  Design-Doc), und dass `darf_schreiben()` für Mitarbeit falsch bleibt.
- ADR-0005 um die zwei Gate-Typen ergänzen; arc42 Querschnitt Sicherheit nach Mitänderungsregel.

## Tests (Kern)

- Je Handler der Positivliste: Mitarbeit erlaubt (2xx), Beobachter 403.
- Je ausgewähltem verbotenen Weg (Kräfte anlegen, Abschnitt, Einstellungen, Kanal anlegen,
  Meldung zuweisen, ETB-Auftrag): Mitarbeit 403.
- Eigen-Prüfungen: fremde Meldung korrigieren 404, Lagemeldung anlegen 403, eigene Meldung auf
  Lagemeldung umstellen 403, ETB-Typ `anordnung` 403, Berichtigung fremden Eintrags 403, fremder
  Anhang in `anhang_ids` 403.
- Kopplung Rückfluss: `beobachter` von Gegenüber ohne Fähigkeit überschreibt `mitarbeit` nicht.
- Migration: bestehende Mitgliedschaften bleiben, `mitarbeit` lässt sich einfügen, die Trigger
  schreiben weiter `einsatz_aenderung`.
- Kopplung: an ein Gegenüber ohne Fähigkeit geht `beobachter`, an eines mit Fähigkeit
  `mitarbeit`; Spiegel-Antrag ETB als Mitarbeit erlaubt, Personen-Antrag 403.
- Frontend: `schreibrecht.test.ts` für `darfImEinsatzErfassen`; Komponententests für
  Meldungs-, Chat- und ETB-Erfassung mit Rolle Mitarbeit.

## Dem Umsetzenden überlassen

- Genaue Namen der Hilfsfunktionen und der Migration.
- Ob die Fähigkeitsspalte in dieselbe Migration wie der Tabellenumbau kommt.
- Ob weitere Felder von `NeueMeldung` (etwa `bestaetigung_pflicht`) für Mitarbeit gesperrt
  werden; im Zweifel offen lassen, denn die Lage-Frage ist entschieden (19.11.2026: keine
  Lagemeldung durch Mitarbeit).
