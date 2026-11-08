# Design

## Context

Zur Motivation siehe proposal.md, Abschnitt „Why“. Was heute am Modul `stab` hängt, laut
Scope-Scan vom 08.11.2026 (Stand `d22ba2f`, höchste Migration 0298):

- **Besetzung S1–S6** (`einsatz_stabsfunktion`, `src/stab/repo.rs`) ist nicht nur eine Seite. Sie
  ist Datenquelle für Bleibendes:
  - die Auflösung „S2 → Person“ (`src/fuehrung/aufloesung.rs`, nur mit Stab-Recht) für
    Auftragsempfänger, Erinnerungen und Chat-Erwähnungen,
  - die Benachrichtigungen (`src/benachrichtigung/aufloesung.rs`; die Funktion der
    Mitgliedschaft dient dort schon als Rückfall),
  - `meine_sachgebiete`/`meine_funktion` (`src/einsatz/{mod,funktion}.rs`) samt Funktions-Snapshot
    am ETB-Eintrag (`etb/repo.rs:55`),
  - der Absender-Rückfall der Führungsstelle (`fuehrungsstelle::absender_tx`),
  - die Stabsstelle im Organigramm, die Sachgebietszeichen in der Fernmeldeskizze, die Spalte
    „Besetzung“ im Kommunikationsplan, „Stab:“ in der Eigenen Lage und der Block im Einsatzbericht.
- **`einsatz_mitgliedschaft.fuehrungsfunktion`** (0128, Katalog EL, S1–S7, FHP, FB) ist schon da.
  Die Einsatzleitung pflegt sie im Abschnitt „Mitglieder“ (`PUT …/mitglieder/{benutzer_id}`), und
  jedes Mitglied darf sie lesen (`GET …/mitglieder`, `EinsatzLesezugriff`).
- **`src/stab/` und `src/routes/stab.rs`** enthalten auch das Fernmeldewesen: `kommunikation.rs`,
  `fernmeldeskizze.rs`, 25 Handler und `sse_fernmeldewesen`. Ebenso liegt der allgemeine
  Lebenszyklus-Riegel `fordere_aktiv_in_tx` dort. `frontend/src/stab/` trägt Funkplan, Skizze,
  Sprechgruppen und Kommunikationsplan sowie Helfer, die Lageberichte, Organigramm und
  Lagebesprechung importieren.
- **Das Informationstelefon** (`infotelefon_anruf`, `src/routes/infotelefon.rs`) hängt am Stab:
  - über das Gate `EinsatzLesezugriff<Stab>`, den Pfad `…/stab/infotelefon` und das Live-Recht `stab`,
  - über die Anliegen-Labels in `frontend/src/presse/labels.ts`,
  - an keiner Presse-Tabelle.
- **Fremdschlüssel:**
  - `etb_eintrag.pressemitteilung_id → pressemitteilung(id)` (0129:36),
  - `medienkontakt.pressemitteilung_id → pressemitteilung`,
  - `pressemitteilung.etb_eintrag_id → etb_eintrag`.
  - Ein `DROP TABLE pressemitteilung` bei stehender Spalte lässt jedes spätere ETB-INSERT
    scheitern (`no such table`).

## Goals / Non-Goals

**Goals:**
- Stab und S5 sind aus Code, Datenbank, Routen, Live-Ereignissen, Doku und Website verschwunden.
- Alles, was heute „S2 → Person“ auflöst, liest dieselbe eine Quelle: die Mitgliedschaft.
- Fernmeldewesen, Lagebesprechung, Informationstelefon, Lageberichte und Organigramm verhalten
  sich für den Bediener wie vorher. Ausnahme ist die Quelle der Sachgebiete (D2).

**Non-Goals:**
- Kein Ersatz für die Checkliste Arbeitsaufnahme, das Presse-Log oder die Pressemitteilung.
- Keine Umbenennung von API-Pfaden, Wire-Werten oder Spec-Namen über das Nötige hinaus. Es gilt
  die Grenzwert-Regel aus `AGENTS.md`: `…/stab/kommunikationsplan`, `…/stab/fernmeldeskizze`,
  `…/stab/infotelefon` und die Specs `stab-*` behalten ihren Namen.
- Keine neue Pflegefläche für Führungsfunktionen. Gepflegt wird weiter unter „Mitglieder“.
- Kein Modulzähler für das Informationstelefon.

## Decisions

### D1 Entfernen statt ausblenden

Entscheidung Ruben, 08.11.2026. Ausblenden über die Freigaben (LLH-1179) wäre billiger und
umkehrbar. Es ließe aber Code, Tabellen, Schwärzungspfade und Tests für ein ungenutztes Modul
weiterlaufen. Der Rückweg ist Git und eine neue Change.

### D2 Auflösung S1–S6 über die Mitgliedschaft

Jede Stelle, die heute `einsatz_stabsfunktion` liest, liest stattdessen
`einsatz_mitgliedschaft.fuehrungsfunktion` des Einsatzes. Das betrifft
`fuehrung::aufloesung`, `benachrichtigung::aufloesung`, `einsatz::funktion`,
`einsatz::mod` (`meine_sachgebiete`) und `fuehrungsstelle::absender_tx`.

- **Recht:** Die Auflösung braucht kein Modulrecht mehr, nur den Einsatz-Lesezugriff. Dieselben
  Namen stehen ohnehin in `GET …/mitglieder`. `darf_stab_lesen` entfällt. Gekoppelte Geräte
  bleiben ausgeschlossen, wie heute in `aufloesung.rs:141–145`.
- **Mehrdeutigkeit:** Die Mitgliedschaft erzwingt keine Eindeutigkeit, die Besetzung tat es. Haben
  mehrere Mitglieder dieselbe Funktion, gelten alle. Die Benachrichtigung erreicht alle. Die
  Anzeige nennt alle Namen alphabetisch, getrennt durch „, “. `meine_sachgebiete` ist die Menge
  der Sachgebiete aus der eigenen Funktion, also höchstens eines.
- **Wire-Form bleibt:** `AktuelleBesetzung`/`BesetzungsZustand` und `meine_sachgebiete` bleiben
  als Felder erhalten (Grenzwert-Regel). Erzeugt werden nur noch `personal` (mit Name) und
  `nicht_vergeben`. `einsatzleitung`, `extern` und `rueckwaertig` bleiben im Enum, werden aber
  nicht mehr geliefert. Der Client behandelt sie weiter, das kostet nichts.
- **Konsequenz:** S1–S6 kann nur sein, wer ein Benutzerkonto und eine Mitgliedschaft im Einsatz
  hat. Eine Helferin ohne Konto konnte die Besetzung tragen, die Mitgliedschaft nicht. Das ist
  in Kauf genommen: Wer im Fükw eine Funktion führt, bedient in der Regel auch die Anwendung.
- **Verworfen:**
  - Die Besetzung ohne Stab-Seite behalten (widerspricht D1, zweite Pflegestelle).
  - Ersatzlos streichen. Dann erreichten Benachrichtigungen an S1–S6 niemanden, Organigramm und
    Skizze verlören die Sachgebiete.

### D3 Informationstelefon als eigenes Modul `infotelefon`

Vorbild sind LLH-1111 (Lagebesprechung) und LLH-1180 (Fernmeldewesen).

- **Registry:** Key `infotelefon`, Kategorie `kommunikation`, Label „Informationstelefon“, Icon
  `IconTelefon`, Status `fertig`, Beschreibung „Bürgeranrufe, Rückrufe, Anliegen“.
- **Backend:** Der Marker `Infotelefon` kommt in `MODUL_KEYS`/`modul_marker!`. Der Pfad bleibt
  `…/stab/infotelefon`, ein längeres Präfix in `PFAD_KEY` zeigt auf `infotelefon` (Muster
  LLH-1180 D4). `LiveEvent::Infotelefon` wird auf `["infotelefon"]` gegatet.
- **UI-Route** `/einsaetze/:id/infotelefon`. `ALTPFAD_MODUL['stab/infotelefon'] = 'infotelefon'`
  leitet weiter und behält die Query (`?anruf=`, `?neu=1`).
- **Freigaben** nach dem Muster 0224 (Aufspaltung ohne Entsperren): Die Migration kopiert
  `benoetigte_rolle` **und** die Sichtbarkeit von `stab` auf `infotelefon`, in
  `einsatz_modul_override`, `org_modul_einstellung` und `einsatz_vorlage_modul_aus`. Dort
  verlangt 0238, Ausblendungen bei Aufspaltung mitzunehmen. Die Startvorlagen
  (`EINSATZ_VORLAGE_STARTLISTE`) blenden künftig `infotelefon` aus, wo sie heute `stab`
  ausblenden. Wer den Stab nicht sah, sieht auch das Informationstelefon nicht.
- **Anliegen:** Der Wert `presse` („Presseanfrage“) bleibt. Ein Bürger kann weiter eine
  Presseanfrage stellen, und er ist ein gespeicherter Wire- und CHECK-Wert. Die Labels ziehen nach
  `frontend/src/infotelefon/labels.ts`.
- **Verworfen:**
  - Neuer API-Pfad `…/infotelefon`: bricht ältere PWA-Clients ohne Nutzen.
  - Nur die Rolle kopieren (Muster 0184/0186): Das würde das Informationstelefon überall dort
    neu einblenden, wo der Stab bewusst aus war, auch in allen sechs Startvorlagen.

### D4 Alle Stab- und Presse-Tabellen per Migration löschen

Entscheidung Ruben, 08.11.2026. Neue Migrationen werden angehängt, Nummern größer als jede auf
`origin/alpha` (heute 0298). Geprüft wird mit `scripts/check-migrationen.sh` vor dem Push.

- **Migration A, „infotelefon_modul“:** Freigaben, Overrides und Vorlagen-Ausblendungen nach D3
  kopieren, dann alle Zeilen mit `modul_key = 'stab'` aus den drei Tabellen löschen. Dieselbe
  Migration erledigt beides, damit nie ein unbekannter Key übrig bleibt. Sonst antwortet
  `normalize_ausgeblendet` beim Speichern einer Vorlage mit 400.
- **Migration B, „stab_presse_entfernen“**, in dieser Reihenfolge:
  1. `ALTER TABLE etb_eintrag DROP COLUMN pressemitteilung_id`
  2. `DROP TABLE medienkontakt`
  3. `DROP TABLE pressemitteilung`
  4. `DROP TABLE einsatz_stab_checkliste`
  5. `DROP TABLE einsatz_stabsfunktion`

  Die Indizes fallen mit ihren Tabellen.
- **DROP COLUMN** schreibt `etb_eintrag` um. Laut Scan hängt an der Spalte kein Index, und die
  FTS-Trigger lesen sie nicht. SQLite erlaubt `DROP COLUMN` nicht für jede Spalte mit
  Fremdschlüssel. Deshalb ist **Aufgabe 1 ein Migrationstest gegen das gebündelte SQLite**
  (`libsqlite3-sys 0.37`), bevor irgendetwas anderes entsteht.
  - Schlägt er fehl, wird `pressemitteilung` nicht gedroppt, sondern geleert und als reines
    Fremdschlüsselziel stehen gelassen. Die Spalte wird auf NULL gesetzt, und das wird hier im
    Design nachgetragen.
  - Ein voller Neubau von `etb_eintrag` (FTS, viele eingehende Fremdschlüssel) ist verworfen.
- **Schwärzung und Aufbewahrung:** Die Registry-Einträge der vier Tabellen und der Spalte fallen
  weg. Ebenso entfallen `PERSONENBEZUEGE` für Stabsfunktion und Medienkontakt, die Personensuche
  über Medienkontakte und die Ausnahmen in `tests/aufbewahrung_e2e.rs`. Die DB-getriebenen Guards
  (`jede_einsatz_scoped_spalte_ist_klassifiziert`, `entdeckte_tabellen_gleich_registry_tabellen`)
  belegen den Gleichstand.
- **Löschersuchen:** `PersonenArt::Medienkontakt` entfällt als Suchergebnis, ein reiner
  Ausgabewert. Der Antragswert `ziel_art = 'medienkontakt'` bleibt lesbar, damit alte Ersuchen im
  Verlauf stehen bleiben. Neue Ersuchen mit diesem Ziel lehnt der Server mit 422 ab. Der CHECK
  in 0140 bleibt unverändert.
- **Datenverlust** ist gewollt. Was davon im ETB steht, bleibt als Text: Besetzungswechsel,
  freigegebene Pressemitteilungen, die Meldung an die Leitstelle aus der Checkliste.

### D5 Umzug vor dem Löschen, als eigene `refactor`-Commits

- **Frontend:**
  - Funkplan, Skizze (`stab/skizze/`), Sprechgruppen, Kommunikationsplan, `luecken`,
    `useNetzQuellen`, `SkizzenAufnahme` und `rufnameVorschlaege` ziehen nach
    `frontend/src/fernmeldewesen/`. `rufnameVorschlaege` liest die Skizze und bleibt deshalb dort.
  - `einsatzleiter.ts` und `fuehrungsstelle.ts` ziehen nach `frontend/src/einsatz/`.
  - `md` kommt nach `frontend/src/lib/markdown.ts`.
  - `ZUSTAND_GRUND` und `Quelle<T>` kommen nach `frontend/src/api/abrufZustand.ts`, wo
    `AbrufZustand` steht.
  - `zeilenziel.ts` kommt nach `frontend/src/components/zeilenziel.ts`, mit neutralem Namen
    (`zeilenzielStil`).
  - `frontend/src/stab/AGENTS.md` wird zu `frontend/src/fernmeldewesen/AGENTS.md`, ohne die
    Stab-, Checklisten- und S5-Abschnitte. Der Absatz zum Informationstelefon zieht in
    `frontend/AGENTS.md` oder in eine neue Bereichsdatei unter `infotelefon/`; die Tabelle in der
    Wurzel-`AGENTS.md` wird nachgezogen.
- **Backend:**
  - `src/stab/{kommunikation,fernmeldeskizze}.rs` ziehen nach `src/fernmeldewesen/`.
  - Die Fernmeldewesen-Handler ziehen aus `routes/stab.rs` nach `routes/fernmeldewesen.rs`.
  - `fordere_aktiv_in_tx` kommt nach `src/einsatz/repo.rs`.
  - `Sachgebiet` kommt nach `src/fuehrung/`, wo die Labels S1–S6 gebraucht werden.
  - Die Testpfade `lifeline_hub::stab::…` werden nachgezogen.
- **Begründung:** Erst nach dem Umzug ist `stab/` reiner Stab und lässt sich als Ganzes löschen.
  Ein roter Test zeigt dann eindeutig, ob der Umzug oder das Löschen ihn auslöst. Der Umzug
  ändert kein Verhalten, keinen Pfad und keinen Schema-Namen (utoipa nimmt den Typnamen).

### D6 Medienlage bleibt Freitext

Der Abschnitt `medienlage` bleibt in `lagebericht::VORLAGEN` und `lageberichte/vorlagen.ts`. Er
ist ein Punkt des Lagevortrags, auch ohne Stab. Nur `MEDIENLAGE_QUELLE` („Aus S5 übernehmen“)
und `stab/medienlage*` entfallen. Bestehende Lageberichte und Entwürfe bleiben unberührt.

### D7 Was aus der Mitgliedschaft neu gelesen wird

- **Organigramm:** Die Stabsstelle erscheint, sobald mindestens ein Mitglied S1–S6 führt. Je
  Sachgebiet steht der Name. Leere Sachgebiete erscheinen nicht, es gibt keinen Zustand
  „nicht besetzt“. Die Stab-Freigabe als Bedingung entfällt.
- **Fernmeldeskizze:** Die Sachgebietszeichen im Kasten „Einsatzleitung“ kommen aus denselben
  Funktionen. Die Quelle in `useNetzQuellen` heißt „Mitglieder“ statt „Stab-Besetzung“.
- **Kommunikationsplan:** Die Spalte „Besetzung“ der Funktionszeilen S1–S6 zeigt die Namen aus
  der Mitgliedschaft.
- **Eigene Lage** (Lagebericht) und **Einsatzbericht** (Block „Führung“): Die Zeile bzw. der
  Block heißt „Führungsfunktionen“ statt „Stab“ und listet EL und S1–S7 aus der Mitgliedschaft.
- **Quelle im Frontend** für alles ist `GET …/mitglieder`, mit einer gemeinsamen Ableitung
  `fuehrung/besetzungAusMitgliedern.ts`. Damit gibt es keine zweite Zuordnung „Funktion → Name“.

### D8 Alte Deeplinks

- `…/stab/funkplan` und `…/stab/kommunikationsplan` behalten ihre Weiterleitung (`ALTPFAD_MODUL`).
  Sie hängt nicht am Modul `stab`.
- `…/stab/infotelefon` leitet nach D3 weiter.
- `…/stab`, `…/stab/presse` und `…/stab/presse/mitteilungen/:id` leiten auf den Einsatz
  (`/einsaetze/:id`) weiter. Heute fallen sie auf `/einsaetze` zurück und verlieren den Einsatz.
  Es gibt keine eigene Hinweisseite.

### D9 Doku, Hilfe, Website, ADR

- **Hilfe-Bereich:** „Stab“ (Reihenfolge 400–499) heißt „Führungsorganisation“
  (`hilfe/bereiche.ts`, Website-Kopie, `docs/anwender/AGENTS.md`).
- **Kapitel:** `stab.md` entfällt, `presse-infotelefon.md` wird `infotelefon.md`. Die Bilder
  werden neu aufgenommen, die Bilder des Stabs und der Presse entfallen.
- **Website:** Der Werbetext „Stab in S1 bis S6“ und die Kennzahl „6 Sachgebiete“ entfallen,
  `module.json` folgt der Registry.
- **Neue ADR** „Lifeline Hub hat kein Stab-Modul“. Sie verbietet `src/stab`, `frontend/src/stab`,
  `src/presse` und den Modul-Key `stab` per Prüfung. Dazu kommen Kapitel 5 (Bausteinsicht),
  Kapitel 9 und das Glossar.
- Wer den Stab zurückholen will, löst die ADR mit einer neuen Change ab.

## Risks / Trade-offs

- [Gebündeltes SQLite verweigert `DROP COLUMN` auf der FK-Spalte] → Aufgabe 1 prüft das zuerst
  per Migrationstest. Der Rückfall nach D4 steht fest und ändert weder Specs noch Aufgabenschnitt.
- [Die Migration schreibt `etb_eintrag` um, die größte Tabelle; Dauer und WAL-Größe beim Start]
  → Messung in Aufgabe 1 mit einer DB in Demo-Größe. Es läuft einmalig, im Start vor dem Bind.
- [Mehrere Mitglieder mit derselben Funktion statt einer eindeutigen Besetzung] → Alle gelten
  (D2). Die Benachrichtigung erreicht dann mehr Menschen statt niemanden, was auf der sicheren
  Seite liegt.
- [S1–S6 ohne Benutzerkonto nicht mehr abbildbar] → Bewusst in Kauf genommen (D2). Der
  Kommunikationsplan kennt weiter externe Stellen und Freitext.
- [Großer Diff über Backend, Frontend, e2e und Doku in einem PR] → Getrennte Commits in der
  Reihenfolge von `tasks.md`. Jeder Commit ist für sich grün, die Umzüge ändern kein Verhalten.
- [Ältere PWA- oder Offline-Clients rufen `GET …/stab` oder Presse-Routen auf] → Die Routen sind
  weg und antworten 404. Kein Offline-Lagebild enthält sie (`LAGEBILD_OFFLINE`), die
  Infotelefon-Pfade bleiben. Live-Ereignisse `stab`/`presse` kommen nicht mehr, unbekannte gab es
  vorher nicht.
- [Alte Löschersuchen mit Ziel Medienkontakt zeigen auf gelöschte Daten] → Sie bleiben im Verlauf
  lesbar (D4). Das Ziel ist ohnehin gelöscht, und genau das wollte das Ersuchen.

## Migration Plan

1. Migration A (Freigaben stab → infotelefon, `stab`-Zeilen löschen) und Migration B (Tabellen
   und Spalte löschen) laufen beim Start in derselben Version. Ein Feature-Flag gibt es nicht.
2. **Rollback:** Eine ältere Binärversion startet auf der migrierten DB nicht, sqlx kennt die
   neuen Migrationen nicht. Der Rückweg ist das Backup vor dem Update (Betrieb wie bei jeder
   Migration).
