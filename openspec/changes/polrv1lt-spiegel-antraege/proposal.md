# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/polrv1ltvkbi1k51sp0yaild (LLH-1492, Epic LLH-1489)

## Why

Ein Einsatz soll an einer gekoppelten Instanz mitlesbar sein, die ihn nicht führt: Der
Verwaltungsstab liest am Hub, was der ELW schreibt, und der ELW liest einen Einsatz, den der Hub
führt (Entscheidungen 3, 5, 6 und 14 im Konzept
`docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`). Mit der Kopplung (LLH-1490) und der
Stammdaten-Verteilung (LLH-1493) gibt es jetzt den signierten Weg und dieselben Konten und
Fahrzeuge an beiden Seiten. Zwischen zwei Instanzen fließen aber noch keine Einsatzdaten. Ohne
Spiegel bleibt der Hub für laufende Einsätze leer, und LLH-1491 (Übergabe, Notübernahme),
LLH-1494 (Archiv) und LLH-1496 (Lagebild für Externe) haben nichts, worauf sie aufbauen.

## What Changes

- **Änderungslog je Einsatz per Trigger.** Ein Log hält fest, welche Zeile eines Einsatzes sich
  geändert hat, auch beim harten Löschen. Trigger an jeder Tabelle des Einsatzes füllen es, so
  wie das Stammdaten-Log aus LLH-1493. Die Tabellenmenge ist dieselbe, die die
  Schwärzungs-Registry kennt, und ein Wächter hält beide gleich.
- **Spiegel.** Eine Instanz, die einen Einsatz nicht führt, hält ihn als Spiegel in denselben
  Tabellen wie ihre eigenen Einsätze. Fremde IDs werden auf lokale abgebildet. Seiten, Druck,
  Suche und Offline-Lesen funktionieren deshalb unverändert. Wer einen Einsatz angelegt hat,
  führt ihn. Übergabe, Notübernahme und Epoche bringt LLH-1491.
- **Nachholen über die Position im Log, in beide Richtungen.** Eine neue signierte Route neben
  der Meldung gleicht die Einsätze der gekoppelten Orgs ab. Die Verbindung baut weiter nur die
  meldende Seite auf. Führt sie den Einsatz, schickt sie ihren Log-Ausschnitt in der Anfrage,
  führt die erreichte Seite, kommt er in der Antwort. Je Einsatz gilt ein Stand, und die
  spiegelnde Seite nennt ihn. Nach einer Pause kommt nur der aktuelle Stand jeder Zeile, nicht
  jede Zwischenfassung.
- **Schmale Leitung.** Anträge und ihre Quittungen stehen in jeder Nachricht vorn. Anhänge kommen
  zuerst nur als Metadaten. Den Inhalt holt der Spiegel, sobald ihn jemand öffnet. Im Leerlauf
  lädt er ihn außerdem in Stücken vorab. Solange ein gespiegelter Einsatz aktiv ist, wird alle
  5 s abgeglichen, sonst im Takt der Meldung.
- **Kategorie und Freigabestufe.**
  - Jede gespiegelte Zeile trägt im Protokoll ihre Kategorie: Führung, ETB, Lage, Kräfte,
    Personen (Art. 9), Betreuung, Kommunikation oder Anhänge.
  - Der Einsatz trägt eine Freigabestufe. Gebaut wird nur „alles“, sparsamere Stufen kommen
    später ohne Protokollbruch.
- **Am Spiegel wird nicht geschrieben, sondern beantragt.** Die Datenbank sperrt jeden direkten
  Schreibweg (409). Die 18 Erfassungen, die heute schon ohne Netz vormerkbar sind, werden am
  Spiegel zum Antrag:
  - ETB-Eintrag und Meldung,
  - die Einträge an einer Person, das Anlegen einer Person,
  - Stand- und Belegungsmeldung, Registrierung und Abmeldung,
  - Eintreffen, Verpflegungsausgabe,
  - Eingänge gelesen und quittiert.

  Ein Antrag steht „ausstehend“, bis der Führer ihn übernommen hat. Der Führer führt ihn im
  Namen des Kontos aus, als käme er von dort. Lehnt der Führer ab, steht der Antrag mit Grund
  da. Alles andere ist am Spiegel gesperrt, mit dem Grund „Spiegel von …“.
- **Oberfläche am Spiegel:**
  - Ein Hinweisband zeigt „Spiegel von <Gegenstelle>“, den Stand und die Zahl ausstehender und
    abgelehnter Anträge.
  - Schreibknöpfe verhalten sich wie beim Beobachter, ausgenommen die beantragbaren Erfassungen.
  - Die Seite „Instanzkopplung“ zeigt je Kopplung die gespiegelten und die gelieferten Einsätze
    samt Stand.

## Capabilities

### New Capabilities

- `einsatz-spiegel`: Wie ein Einsatz an einer gekoppelten Instanz, die ihn nicht führt, als
  Lesekopie entsteht und aktuell bleibt. Dazu gehören Änderungslog, Nachholen über den Stand in
  beide Richtungen, Abbildung der IDs, Schreibschutz, Kategorie und Freigabestufe, Anhänge auf
  Abruf, Takt und die Anzeige am Spiegel.
- `spiegel-antraege`: Wie Schreibwünsche an einem Spiegel zu Anträgen werden, zum Führer gelangen,
  dort im Namen des Kontos übernommen oder abgelehnt werden und am Spiegel „ausstehend“,
  „übernommen“ oder „abgelehnt“ zeigen.

### Modified Capabilities

Keine. Die neue Route folgt den bestehenden Anforderungen von `instanz-kopplung` (Signatur,
Richtung, N/N−1). Die Protokollversion steigt auf 2. Ein Gegenüber mit Version 1 kennt keinen
Spiegel, und dann wird schlicht nicht gespiegelt; das regelt `einsatz-spiegel`.

## Impact

- **Backend:**
  - neues Modul `src/instanz/spiegel/`: Log-Beschreibung, Liefern, Übernehmen, Anhänge,
    Anträge, Takt;
  - `src/instanz/extractor.rs`: Körpergrenze je Route;
  - `src/routes/instanz.rs` und `src/app.rs`: neue Routen;
  - Fehlerabbildung `src/error.rs`: 409 aus dem Schutz-Trigger;
  - Antragsweg vor den 18 Schreibrouten;
  - Ausführen im Namen des Kontos über den bestehenden Router;
  - Live-Ereignis nach einer Übernahme (`src/live/`).
- **Migrationen:**
  - Tabelle `einsatz_aenderung` mit Log- und Schutz-Triggern an rund 119 Tabellen;
  - Tabellen `einsatz_spiegel`, `spiegel_herkunft`, `spiegel_uebernahme` (Merker),
    `spiegel_ziel`, `spiegel_antrag` und der Anhang-Abruf;
  - Spalten `einsatz.kennung` und `einsatz.freigabestufe`;
  - neue `admin_audit`-Aktionen.
- **Frontend:**
  - Feld `spiegel` am Einsatzkopf, Regel `darfBeantragen` in `einsatz/schreibrecht.ts`;
  - Hinweisband und Antragsliste;
  - die vormerkbaren Erfassungen verstehen die Antwort „beantragt“;
  - Abschnitt Spiegel auf der Seite „Instanzkopplung“.
- **Doku:**
  - neue ADR zum Spiegel (Muster und Grenzen);
  - Architekturdoku Kapitel 5, 6, 8 und 11;
  - `src/AGENTS.md` (Abschnitt Instanzkopplung: Trigger-Pflicht für neue Einsatztabellen) und
    `frontend/src/offline/AGENTS.md`;
  - Anwenderdoku `instanzkopplung.md`;
  - offene Frage „schmale Leitung“ in der Konzeptnotiz beantworten.
- **Keine Wirkung auf ungekoppelte Instanzen:** Die Trigger schreiben das Log, aber ohne
  Kopplung liest es niemand, und ohne Spiegel greift kein Schutz.
- **Nicht in dieser Change:**
  - Anträge auf Stammdaten (lokale Ergänzung an den Hub);
  - Übergabe und Notübernahme (LLH-1491);
  - Archiv und Löschen (LLH-1494);
  - sparsamere Freigabestufen und die geschwärzte Ansicht (LLH-1496);
  - ELW↔ELW (LLH-1497).
