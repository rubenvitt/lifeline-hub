# Verwaltung: Übersicht als Einstieg, Mitglieder schon beim Anlegen — Entwurf

Stand: 19.11.2026 · LLH-1820 · Lösungsweg abgestimmt mit Ruben am 19.11.2026 (Phase-1-Checkpoint)

Zunder: https://zunder.rubeen.dev/#/aufgabe/efvk5rbs30e82bwhir4hlxjl

## Absicht

Wer eine Bereitschaft neu einrichtet, findet in der Verwaltung 30 Menüpunkte und landet auf
„Einsatz-Stichworte“. Nirgends steht, ob die Organisation schon bereit für den ersten Einsatz ist.
Außerdem werden Benutzer zweimal gepflegt: zuerst in der Verwaltung, danach in jedem Einsatz noch
einmal unter „Zugriff“. Die Aufgabe hat deshalb zwei Teile:

- **Teil A — Übersicht.** `/admin` öffnet eine Seite „Übersicht“. Sie zeigt den Bestand der
  Bereitschaft und sagt in einem Satz, was für einen Einsatz noch fehlt.
- **Teil B — Mitglieder beim Anlegen.** Schon im Dialog „Neuen Einsatz anlegen“ lassen sich
  Personen auswählen. Sie werden mit dem Einsatz zusammen in einer Transaktion aufgenommen.

## Ziele

- `/admin` führt immer auf die Übersicht. Sie ist der erste Menüpunkt der Verwaltung.
- Die Übersicht zählt fünf Bestände: Benutzer, Fahrzeuge, Personal, Einheiten-Vorlagen und
  Einsatz-Vorlagen. Jeder Bestand ist eine Zeile mit Zahl, Zustand und Sprung zur passenden
  Verwaltungsseite.
- Über den Zeilen steht ein Satz: „Für einen Einsatz fehlt: …“. Er nennt nur die Pflichtpunkte.
  Empfehlungen stehen gedämpft in ihrer Zeile. Fehlt nichts, lautet der Satz „Bereit für einen
  Einsatz.“
- Im Dialog „Neuen Einsatz anlegen“ gibt es einen eingeklappten Teil „Mitglieder“. Gewählte
  Personen werden atomar mit dem Einsatz aufgenommen. Jede Person bekommt die Vorgabe
  Führungspersonal, die sich pro Person ändern lässt. Wer anlegt, bleibt Einsatzleitung.
- Wer so aufgenommen wird, bekommt denselben Hinweis „Aufgenommen in …“ wie bei einer Aufnahme
  über „Zugriff“.

## Nicht-Ziele

- Ein Stammteam an Einsatz-Vorlagen, also feste Mitglieder je Vorlage. Kommt bei Bedarf als
  eigene Aufgabe.
- Die Menüstruktur der Verwaltung umbauen, Punkte zusammenlegen oder umbenennen.
- „Zugriff“ im Einsatz ändern. Es bleibt der Weg für alle Änderungen nach dem Anlegen.
- Die Startliste „Einsatz starten“ im Überblick (LLH-1815). Sie betrifft einen laufenden Einsatz,
  die Übersicht dagegen die Organisation.
- Was LLH-1816 im selben Dialog macht: Vorlage als oberstes Feld, Stichwort-Kopplung, Überdeckung.

## Anti-Ziele

- Die Übersicht verrät einer Führungskraft Namen oder Konten, die sie heute nicht sieht.
  `/api/benutzer` darf nur der System-Admin lesen.
- Der Einsatz entsteht, aber die Mitglieder fehlen halb, weil ein Teil der Schreibvorgänge
  gescheitert ist.
- Der Dialog wächst sichtbar über fünf Felder (Feldbudget LFH-1175).
- In der Auswahl stehen Gerätekonten, Stellvertreter-, Archiv- oder deaktivierte Konten oder
  Personen anderer Organisationen.

## Rahmen

- **Zugang zur Verwaltung:** `darf_admin_bereich` (`src/auth/mod.rs:136`). Das ist der
  System-Admin **oder** eine Führungskraft der Organisation. Die Übersicht erben also beide.
  Das korrigiert eine Annahme aus dem Phase-1-Checkpoint („nur Admins“). Gemeint war, dass nur
  Personen mit Verwaltungszugang sie sehen, und das bleibt so.
- **Anlegen:** `darf_einsatz_anlegen`, derselbe Personenkreis.
- **Konten, die nicht zählen:** Gerätekonten (`geraet::repo::OHNE_GERAETEKONTEN`) und
  Stellvertreter- und Archivkonten (`instanz::spiegel::OHNE_STELLVERTRETER`). Deaktivierte
  Konten (`benutzer.aktiv = 0`) zählen auch nicht. So filtert auch die heutige Auswahl unter
  „Zugriff“ (`einsatz::repo::mitglied_auswahl`).
- **Typ-Codegen:** Antwort-DTOs mit `utoipa::ToSchema`, eingetragen in `src/api_doc.rs`, danach
  `scripts/check-typ-codegen.sh`. Request-DTOs pflegt das Frontend von Hand
  (`src/AGENTS.md`, „Typ-Codegen“).
- **Statuscodes:** Ein fremder, unbekannter oder unzulässiger Wert in der Anfrage ist 400 mit
  Feldfehler, und es entsteht kein Einsatz (`src/AGENTS.md`, „Statuscode-Konvention“).
  Eingabegrenzen gelten nach `src/AGENTS.md`, „Eingabegrenzen“.
- **Dialog:** Er wird gerade in LLH-1816 umgebaut, in `frontend/src/pages/EinsaetzePage.tsx`.
  Die Oberfläche von Teil B entsteht erst, wenn LLH-1816 auf `alpha` ist. Backend und Tests von
  Teil B dürfen vorher entstehen.
- **Größere UI:** Die Übersicht ist eine neue Seite. Deshalb wird sie vor dem Bauen mit `/design`
  auf Grundlage des Design Systems entworfen und unter
  `docs/design/2026-11-19-verwaltung-uebersicht/` abgelegt (`frontend/AGENTS.md`, „Größere
  UI-Entwürfe über das Design System“). Der Teil „Mitglieder“ im Dialog ist kein größerer
  Entwurf.

## Ansätze

### Teil A — woher die Zahlen kommen

- **A1 — eigener Endpunkt, der zählt (gewählt).**
  - Neu ist `GET /api/verwaltung/bereitschaft`. Er ist an `darf_admin_bereich` gebunden, zählt
    in der eigenen Organisation und liefert nur Zahlen.
  - Vorteile: eine Anfrage, und eine Führungskraft bekommt die Benutzerzahl, ohne die
    Benutzerliste lesen zu dürfen.
- A2 — die Seite ruft die fünf vorhandenen Listen ab und zählt selbst. Verworfen: Eine
  Führungskraft darf `/api/benutzer` nicht lesen, es wären fünf Abrufe ganzer Listen, und die
  Übersicht hinge von der Form jeder Liste ab.
- A3 — der Server bewertet auch, also Pflicht oder Empfehlung, und liefert den Satz gleich mit.
  Verworfen: Die Wertung ist Darstellung und ändert sich eher als der Bestand. Als reine
  Funktion im Client ist sie mit Tabellentests billig festzuhalten.

### Teil B — wie die Mitglieder in die Transaktion kommen

- **B1 — eigener Schritt in derselben Transaktion (gewählt).**
  - Eine neue Repo-Funktion legt an und nimmt auf. Sie ruft in **einer**
    `write_retry!`-Transaktion zuerst `anlegen_tx` und danach einen neuen Schritt
    `mitglieder_aufnehmen_tx`.
  - `NeuerEinsatzDaten` bleibt unverändert. Ein neues Feld dort würde 24 Literale in 18 Dateien
    berühren, darunter Demo-Import, Planungsübernahme und Spiegeltests.
  - Die Route zum Anlegen nutzt die neue Funktion. Ohne Mitglieder verhält sie sich wie heute.
- B2 — Feld `mitglieder` in `NeuerEinsatzDaten`. Fachlich dasselbe, aber ein breiter Diff, und
  Demo-Import und Planungsübernahme bekommen ein Feld, das sie nie nutzen.
- B3 — der Client legt an und ruft danach für jede Person
  `PUT /api/einsaetze/{id}/mitglieder/{benutzer_id}`. Verworfen: nicht atomar, das wäre das
  Anti-Ziel „halb geschrieben“.

## Entscheidungen

### Teil A — Übersicht

**Endpunkt** `GET /api/verwaltung/bereitschaft`, Gate `darf_admin_bereich`, sonst 403. Die
Organisation kommt aus der Sitzung. Antwort `Bereitschaft`, Feldnamen sind Vorschlag:

| Feld | Zählt |
| --- | --- |
| `benutzer` | aktive Personenkonten der Org, ohne Geräte-, Stellvertreter- und Archivkonten (einschließlich der anfragenden Person) |
| `fahrzeuge` | `fahrzeug` der Org mit `dienststatus = 'in_dienst'` |
| `personal` | `personal` der Org mit `dienststatus = 'in_dienst'` |
| `einheit_vorlagen` | `einheit_vorlage` der Org mit `aktiv = 1` |
| `einsatz_vorlagen` | `einsatz_vorlage` der Org |

Nur Zahlen, keine Namen. Die Abfrage ist eine `SELECT` mit Unterabfragen, ohne Schreibvorgang.

**Demo-Daten zählen nicht** (Ruben, 19.11.2026). Fahrzeuge, Personal und Einheiten-Vorlagen,
die über `demo_herkunft` (LFH-733) als Demo markiert sind, zählen nicht zu den drei Zahlen oben.
Sie kommen getrennt zurück als `fahrzeuge_demo`, `personal_demo` und `einheit_vorlagen_demo`.
Die Zeile zeigt sie gedämpft, zum Beispiel „+ 12 aus der Demo“. Eine Organisation, die nur
Demo-Daten hat, liest deshalb „Für einen Einsatz fehlt: …“. Einsatz-Vorlagen und Benutzer haben
keine Demo-Marke. Die Tests brauchen einen Fall mit eingespielter Demo.

**Wertung im Client** in einer reinen Funktion (Vorschlag `admin/bereitschaft.ts`). Das ist die
einzige Stelle, die „fehlt“ bestimmt:

- **Pflicht:**
  - `benutzer >= 2`, also mindestens eine weitere Person neben der anfragenden. Wortlaut im Satz:
    „weitere Benutzer“.
  - `fahrzeuge + personal >= 1`, also Fahrzeuge **oder** Personal. Wortlaut: „Fahrzeuge oder
    Personal“.
- **Empfehlung:** `einheit_vorlagen >= 1`, `einsatz_vorlagen >= 1`. Ist bei der Pflicht „Fahrzeuge
  oder Personal“ eines von beiden schon da, ist das jeweils andere eine Empfehlung.
- **Satz:** „Für einen Einsatz fehlt: weitere Benutzer, Fahrzeuge oder Personal.“ Er nennt nur
  die Pflichtpunkte, in der Reihenfolge der Zeilen. Fehlt keiner, heißt er „Bereit für einen
  Einsatz.“, auch wenn noch Empfehlungen offen sind.

**Seite** „Übersicht“ als erster Menüpunkt der Verwaltung, über den Gruppen:

- Kopf mit `AdminPage`.
- Darunter der Satz mit Ton `achtung`, solange Pflicht fehlt, sonst neutral.
- Darunter ein Paneel mit fünf Zeilen. Jede Zeile hat Bezeichnung, Zahl, Zustand (fehlt /
  empfohlen / vorhanden) und einen Sprung „… ↗“ auf die passende Seite:
  - Benutzer → `/admin/benutzer`
  - Fahrzeuge → `stammdaten/fahrzeuge`
  - Personal → `stammdaten/personal`
  - Einheiten-Vorlagen → `stammdaten/einheiten`
  - Einsatz-Vorlagen → `stammdaten/einsatz-vorlagen`
- Die Benutzerseite gibt es nur für System-Admins. Eine Führungskraft sieht die Benutzerzeile
  deshalb ohne Sprung.
- Bausteine aus `components/instrument/` nach der Bausteinwahl in `frontend/AGENTS.md`. Die
  genaue Form legt der `/design`-Entwurf fest.
- Zustände Laden, Leer und Fehler über `SeitenSkeleton` und `SeitenFehler`.

```
ÜBERSICHT                                         Verwaltung
──────────────────────────────────────────────────────────────
▲ Für einen Einsatz fehlt: weitere Benutzer.
──────────────────────────────────────────────────────────────
BEREITSCHAFT
  Benutzer              1   fehlt        Benutzer ↗
  Fahrzeuge             4   vorhanden    Fahrzeuge ↗
  Personal             23   vorhanden    Personal ↗
  Einheiten-Vorlagen    0   empfohlen    Einheiten-Vorlagen ↗
  Einsatz-Vorlagen      2   vorhanden    Einsatz-Vorlagen ↗
```

**Navigation:**

- `adminNav.tsx` bekommt den Eintrag „Übersicht“ (Pfad `/admin/uebersicht`) vor den Gruppen.
- `defaultAdminPfad()` liefert diesen Pfad.
- Weiterleitungen auf `defaultAdminPfad()` (Index, Zugangsprotokoll, Aufbewahrung, Archivakte)
  führen damit von selbst auf die Übersicht.
- Tests mit dem alten Literal `/admin/stammdaten/stichworte` werden angepasst, soweit sie den
  Einstieg meinen. Tests, die die Stichwortseite selbst meinen, bleiben.

**Aktualität:**

- Neuer globaler Query-Key, Vorschlag `globalKeys.bereitschaft()`.
- Er wird mit den Stammdaten-Ereignissen ungültig, die Fahrzeuge, Personal, Einheiten- und
  Einsatz-Vorlagen tragen (`ORG_STREAM_EVENTS.stammdaten`).
- Benutzer sind nicht live. Die Seite lädt beim Öffnen neu, das genügt.
- Der Wächter `queryKeys.guard.test.ts` muss den Key kennen.

### Teil B — Mitglieder beim Anlegen

**Auswahl-Endpunkt:**

- Neu: `GET /api/einsaetze/mitglied-auswahl`, Gate `darf_einsatz_anlegen`, sonst 403.
- Liefert `MitgliedAuswahl { benutzer_id, anzeigename }`, also dasselbe DTO wie die Auswahl unter
  „Zugriff“.
- Enthält aktive Personenkonten der eigenen Organisation, ohne Geräte-, Stellvertreter- und
  Archivkonten und ohne die anfragende Person.
- Der Pfad liegt neben `/api/einsaetze/{id}`. Er darf nicht als `{id}` gelesen werden und steht
  nicht unter `/{id}/`. ADR-0005 und `tests/einsatz_kontext_guard.rs` betrifft er deshalb nicht.
  Weicht der Router aus, ist `/api/einsatz-anlage/mitglied-auswahl` die Ausweichadresse.
- Die Abfrage teilt ihre Filter mit `einsatz::repo::mitglied_auswahl`. Eine gemeinsame
  Abfrage-Basis ist erwünscht, eine zweite Kopie der Filter nicht.

**Anfrage:**

- `NeuerEinsatz` bekommt `mitglieder: Option<Vec<NeuesMitglied>>`.
- `NeuesMitglied { benutzer_id: i64, rolle: String }`, die Rolle wird per `EinsatzRolle::parse`
  geprüft (ADR-0006).
- Fehlt das Feld oder ist die Liste leer, ist alles wie heute.

**Prüfungen vor jedem Schreiben.** Jeder Verstoß ergibt 400 (`AppError::Validation`), und es
entsteht kein Einsatz. Die Meldung nennt die Person, wenn sie bekannt ist. Ein strukturierter
Feldfehler auf dem Wire ist nicht nötig (siehe „Dialog“):

- Rolle unbekannt.
- `benutzer_id` doppelt in der Liste.
- `benutzer_id` ist die anlegende Person. Sie ist immer Einsatzleitung.
- Person gehört nicht zur Organisation, ist inaktiv, ein Gerätekonto oder ein Stellvertreter-
  oder Archivkonto. Alle Fälle bekommen dieselbe Meldung, damit sich fremde Konten nicht
  ertasten lassen.
- Mehr Einträge als eine Obergrenze. Vorschlag: so viele, wie eine Org vernünftig hat, etwa 500,
  nach `src/AGENTS.md`, „Eingabegrenzen“.

**Schreiben:**

- `mitglieder_aufnehmen_tx` schreibt `einsatz_mitgliedschaft` je Person mit der gewählten Rolle,
  in derselben Transaktion wie `anlegen_tx`.
- Die Org-Prüfung steckt zusätzlich in der SQL, so wie bei `setze_mitgliedschaft`.
- Führungsstellen (Funktion) werden beim Anlegen nicht vergeben, das bleibt „Zugriff“
  vorbehalten.

**Nach dem Commit:**

- wie heute `publish_neuer_einsatz`;
- dazu je aufgenommener Person `benachrichtigung::melden` mit Art `EinsatzAufnahme`,
  `.von(anlegende Person)` und `.an(Adressat::Nutzer(id))`, genau wie `mitglied_setzen`;
- kein eigenes `kopf_melden` je Person: `publish_neuer_einsatz` erreicht nach dem Commit jeden
  Leser des neuen Einsatzes, die Aufgenommenen eingeschlossen. Der Spiegel übernimmt neue
  Mitgliedschaften über seine Trigger (Migration 0314).
- `LiveEvent::Mitglieder` braucht es nicht, denn den neuen Einsatz hat noch niemand abonniert.
- Ist eine aufgenommene Person auch Führungskraft, bekommt sie „Neuer Einsatz“ und „Aufgenommen
  in …“. Beide bleiben, weil sie Verschiedenes sagen.

**Dialog** (erst nach dem Merge von LLH-1816):

- Unter den sichtbaren Feldern steht ein eingeklappter Teil „Mitglieder“. Sein Kopf nennt die
  Abweichung von der Vorgabe: „nur du (Einsatzleitung)“ oder „du + 3 Personen“.
- Aufgeklappt:
  - ein `Select mode="multiple"` mit Suche über die Auswahl;
  - darunter je gewählter Person eine Zeile mit Name und Rollen-`Select`. Optionen aus
    `EINSATZ_ROLLE_OPTIONEN`, Vorgabe Führungspersonal;
  - die anlegende Person als feste Zeile „du — Einsatzleitung“.
- Die Auswahl wird erst geladen, wenn der Teil aufgeht.
- Was der Browser vorab prüfen kann (doppelt, man selbst, Rolle gewählt), prüft das Formular.
  Ein Fehler darin öffnet den Teil selbst (`onPruefungGescheitert`), wie es die Regel für
  Klappteile verlangt.
- Eine Ablehnung durch den Server, etwa weil jemand inzwischen deaktiviert wurde, erscheint in
  der allgemeinen Fehlerzeile des Dialogs, mit dem Namen der Person. Der Kopf des Teils nennt die
  Wahl immer („du + 3 Personen“), also bleibt sie sichtbar, ohne aufzuklappen. Das ist meine
  Entscheidung: Ein Feldfehler-Format für den ganzen Server wäre für diesen einen Fall zu breit.
- Die sichtbare Feldzahl bleibt fünf. Der Wächter zum Feldbudget zählt mit `forceRender` und
  macht die Gegenprobe „Aufklappen → Zahl steigt“.

### Regeln, die sich ändern (E2)

- `frontend/AGENTS.md`, „Feldbudget“: Bei der Ausnahme „Neuen Einsatz anlegen“ kommt der
  eingeklappte Teil „Mitglieder“ dazu. Er zählt nicht zu den fünf Feldern, sein Kopf nennt die
  Abweichung. Eine Ablehnung durch den Server meldet die allgemeine Fehlerzeile mit dem Namen der
  Person.
- `frontend/AGENTS.md`: Neue Zeile oder neuer Absatz „Verwaltung — Einstieg“.
  - `/admin` führt auf die Übersicht.
  - „Fehlt“ bestimmt nur `admin/bereitschaft.ts`.
  - Die Übersicht zeigt Zahlen, keine Namen; Demo-Daten zählen nicht mit.
- `src/AGENTS.md`: Neuer Absatz bei „Admin-Spur“ oder als eigener Abschnitt „Einsatz anlegen mit
  Mitgliedern“.
  - Mitglieder kommen atomar mit dem Einsatz.
  - Die anlegende Person ist immer Einsatzleitung.
  - Dieselben Ausschlüsse wie die Auswahl unter „Zugriff“.
  - Jede aufgenommene Person bekommt den Aufnahme-Hinweis.
- Anwenderdoku und Architekturdoku folgen ihrer Mitänderungsregel (`docs/anwender/AGENTS.md`,
  `docs/architektur/AGENTS.md`). Die Bilder entstehen im Bildlauf.

## Was der Bauende entscheidet

- Genaue Feld- und Funktionsnamen nach der Bezeichner-Regel: Fachwort deutsch, Technik englisch.
- Die Form der Übersicht innerhalb der Bausteine. Der `/design`-Entwurf gibt sie vor.
- Ob der Zähl-Endpunkt in einem neuen Modul `src/verwaltung/` oder bei einem bestehenden liegt.
- Die genaue Obergrenze der Mitgliederliste.
- Die Reihenfolge im Plan, mit einer Vorgabe: Teil A und das Backend von Teil B zuerst, die
  Dialog-Oberfläche erst nach dem Merge von LLH-1816. Der PR kommt erst, wenn beides fertig ist.
