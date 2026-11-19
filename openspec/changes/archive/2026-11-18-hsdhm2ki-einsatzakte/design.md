# Design

## Context

Motivation: proposal.md. Bausteine, auf die die Akte baut:

- **Einsatzbericht** (`pages/EinsatzberichtDruckPage.tsx`, `druck/einsatzbericht/`): Weiche
  `berichtFreigabe` (`quellen.ts`) vor dem Abruf, Abruf `ladeEinsatzbericht` mit Zuständen je
  Quelle, Verdichtung, Darstellung `Bloecke`. Wählbare Blöcke über `?bloecke=`.
- **ETB-Druck** (`pages/EtbDruckPage.tsx`): Vollabruf `etb/druckAbruf.ts`, Tabelle
  `etb/EtbDruckTabelle.tsx`.
- **Betroffenenliste** (`pages/PersonenDruckPage.tsx`): Daten nur über `GET …/personen/druck`
  (schreibt `druck` ins `person_zugriff_audit`), `DRUCK_ABFRAGE`, `gcTime: 0`, Tabelle
  `personen/PersonenDruckTabelle.tsx`.
- **Befehl/Lagebericht**: Druck nur auf der Vollseite (`BefehlDetailPage`, `LageberichtDetailPage`)
  mit `BefehlLesefassung` bzw. der Lesefassung des Lageberichts und `entwurf/DokumentAnlagen.tsx`
  (Bildanlagen, je ein Blatt A4 quer, `@page`).
- **Aufträge**: nur Einzelblatt (`AuftragDruckPage`), Liste `listeAuftraege`.
- **Mehrere Kapitel in einer Druckwurzel** gibt es schon: Hilfe-Mappe und Schichtplan
  (`data-lfh="druck-kapitel"`, je Kapitel ein `Druckkopf ebene={2}`).
- **Backend**: Anhänge liegen als BLOB in `anhang`, verknüpft über die Linker in
  `anhang::repo::MODUL_LINKER`; ausgeliefert wird immer `Fassung::Bereinigt`
  (`src/AGENTS.md`, Anhänge), Bytes liest nur `routes/support.rs` (Wächter
  `nur_support_liefert_anhang_bytes_aus`). CSV-Exporte für Personen (Audit `export`), Tiere und
  Schäden bestehen je als eigener Handler. `zip` 9 mit `deflate` ist Abhängigkeit; Streaming aus
  einer Temp-Datei zeigt `routes/backup.rs`.

## Goals / Non-Goals

**Goals:**

- Ein Druckvorgang ergibt die ganze Akte; die Kapitel nutzen die bestehenden Bausteine, keine
  zweite Darstellung desselben Inhalts.
- Ein ZIP mit allen Anhängen und Tabellen, gleiche Rechte und Protokolle wie die Einzelwege.

**Non-Goals:**

- Keine Kapitelwahl (später möglich über `?kapitel=` nach dem Muster `?bloecke=`).
- Kein Original ohne Bereinigung im ZIP: das bleibt der Einzelfreigabe
  (`support::original_freigeben`, Einsatzleitung, ETB-Vermerk je Datei) vorbehalten.
- Keine neue Protokollart, keine Migration.
- Kein Server-PDF, kein Zugriff auf das Archiv der Aufbewahrung.

## Decisions

**D1 — Eine Druckwurzel, Kapitel als `druck-kapitel`.** Die Seite
`pages/EinsatzakteDruckPage.tsx` unter `einsatzdaten/akte` (erbt die nie gesperrten
Einsatzdaten wie der Bericht) setzt je Kapitel eine Hülle `data-lfh="druck-kapitel"` mit eigenem
`Druckkopf` (`ebene={2}`, Dokumentart = Kapitelname, Zeilen Stand/Vorläufig). Muster:
Schichtplan-Blätter. Verworfen: sechs Tabs/iframes oder ein „Druck nacheinander“ — ergibt mehrere
PDFs, genau das Problem der Aufgabe.

**D2 — Kapitel bauen auf den Darstellungs-Bausteinen, nicht auf den Seiten.** Die Seiten bringen
Rahmen (`EinsatzSeite`, Knöpfe, eigene Druckwurzel) mit; die Akte nimmt nur, was darunter liegt:
`Bloecke` + `verdichteEinsatzbericht`, `EtbDruckTabelle`, `PersonenDruckTabelle`,
`BefehlLesefassung`/Lesefassung des Lageberichts + `DokumentAnlagen`. Wo ein Baustein heute fest
an seiner Seite hängt (Lesefassung des Lageberichts, UHS-Namen des Personendrucks), wird er
herausgelöst, ohne seine Seite zu ändern (Snapshot-Tests der Einzeldrucke bleiben grün).
Verworfen: Seiten in die Akte einbetten — doppelte Druckwurzeln und Kopfleisten.

**D3 — Eine Freigabe-Weiche wie beim Bericht.** `druck/einsatzakte/quellen.ts` erweitert die
Bericht-Quellen um `etbVoll` (etb), `personenDruck` (personen), `auftraege` (auftraege),
`befehle` (auftraege), `lageberichteVoll` (lageberichte), jeweils mit dem Gate der Route; die
Funktion `akteFreigabe` nutzt `freigabeDerQuelle` aus `quellen.ts` (exportieren statt kopieren),
mit dem Bericht im vollen Umfang (`BLOECKE` alle). Ergebnis: `abrufen` / `gesperrt` /
`nicht-genutzt` je Quelle; ein `gesperrt` führt in die Sackgasse „Einsatzakte nicht verfügbar“
mit den Modulen. Ein 403 im Abruf heißt „kein Zugriff“, nie leerer Bestand.

**D4 — Ein Abruf, ein nicht-live Key.** `druck/einsatzakte/abruf.ts` lädt alle Kapitel parallel
in einen Schnappschuss (`einsatzKeys.einsatzakteDruck(id)`, `DRUCK_ABFRAGE`, `gcTime: 0`, da
Personendaten). Der Bericht nutzt `ladeEinsatzbericht`, das ETB `ladeEtbVollstaendig` ohne Filter,
Betroffene `ladePersonenDruck` (protokolliert), Befehle/Lageberichte Liste → nur freigegebene →
Einzelabruf. Zustand wie beim Bericht (`bereit` / `kein-zugriff` / `fehler` mit Modulen);
Drucken erst bei `bereit`. Kein Retry: jeder Versuch schriebe einen Personen-Eintrag.

**D5 — Auftragsliste als neues Kapitel.** `druck/einsatzakte/AuftragsListe.tsx` über
`druck/DruckTabelle.tsx` (schlichtes `<table>`), Spalten Nr., Auftrag (Kurztext), Empfänger,
Status, erteilt, erledigt/aufgehoben; Zeiten über `zeitDarstellung`. Felder aus dem Schemakern,
wo vorhanden (`auftragsschemaKern.ts`), keine eigene Feldliste für den Kurztext.

**D6 — ZIP auf dem Server, aus der Temp-Datei gestreamt.**
`GET /api/einsaetze/{id}/einsatzakte/anlagen.zip`, neues Modul `src/einsatzakte/` (Sammeln,
Schreiben) und Handler `src/routes/einsatzakte.rs`. Gate: `EinsatzLesezugriff<OhneModul>` mit
Pfad-Schlüssel in `PFAD_KEY` (ADR-0005); danach für jedes Modul der Akte: im Einsatz
ausgeblendet → Teil fällt weg, sonst `fordere_zielmodul` (403, alles oder nichts). Ablauf:
1. In EINER Transaktion: Liste der Anhänge (über `MODUL_LINKER`, ohne gelöschte, ohne
   Chat; Lagebericht/Befehl nur freigegebene), Audit-Einträge schreiben (`export` für die
   Personentabelle, `anhang` je Personen-Anhang, `anhang_zugriff_audit` je UHS-Anhang), Commit.
   Scheitert das, 500 ohne Daten.
2. In `spawn_blocking`: `ZipWriter` in eine Temp-Datei (`tempfile`), Anhänge `Stored` (Bilder und
   PDFs sind schon komprimiert), CSVs `Deflated`. Bytes je Anhang über eine neue Funktion in
   `routes/support.rs` (`bereinigte_bytes_fuer_akte`), damit der Wächter „nur support liefert
   Bytes aus“ hält. Unbereinigbar → nicht enthalten, Zeile im Inhaltsverzeichnis.
3. Antwort `Body::from_stream` aus der Datei, `Content-Type: application/zip`,
   `Content-Disposition: attachment; filename="Einsatzakte_<nummer>_<JJJJ-MM-TT>_Anlagen.zip"`
   (Datum in der Anzeigezone, ADR-0012-Ausnahme wie Backup-Dateiname), `nosniff`.
Ordner: `<modul>/<datensatz-kennung>/<dateiname>`, Kollisionen mit ` (2)`; Pfade ohne `..`, `/`,
Steuerzeichen (sanitisiert). CSVs: die Builder der drei Exporte werden als Funktionen
herausgezogen und von Export-Route und ZIP geteilt (eine Quelle der Form).
Verworfen: ZIP im Browser (kein Zugriff auf alle Bytes ohne N Einzelabrufe und N Audits, neue
Abhängigkeit), `Vec<u8>` im Speicher (unbegrenzte Summe bei 25 MiB je Datei).

**D7 — Parallelität begrenzen.** Ein ZIP-Bau je Einsatz zugleich (Sperre nach dem Muster
`backup_download.belegen()`, eigene Instanz); ein zweiter Abruf bekommt 409 „ZIP wird bereits
erstellt“. Dazu höchstens zwei Bauten auf dem Server (503): jeder legt eine volle Kopie der
Anhänge neben die Datenbank, eine volle Platte ließe das Schreiben im Einsatz scheitern (Befund
des Reviews). Der Bau läuft in `tokio::spawn`, vom Request entkoppelt wie die Sicherung: ein
abgebrochener Download gibt den Platz erst frei, wenn der Bau fertig ist. Anhänge stornierter
Datensätze (Fehleingaben) fehlen wie in deren Listen und CSVs.

**D8 — Rechte im Client für das ZIP.** Der Knopf steht nur bei `bereit` und lädt über einen
Link mit `download` (Sitzungs-Cookie, kein Blob im Speicher). Der Server bleibt Türsteher.

## Risks / Trade-offs

- [Akte sehr lang (ETB mit Tausenden Einträgen) → Firefox/Safari brechen langsam um] → Kapitel
  sind schlichte Tabellen wie der ETB-Druck; Seitenzahlen trägt nur Chromium (Spec
  `druck-dokumente`). Handprüfung an einem großen Demo-Einsatz.
- [ZIP sehr groß] → Streaming aus der Temp-Datei, Temp-Datei wird nach dem Senden gelöscht;
  Sperre D7.
- [Herauslösen der Lesefassungen ändert Einzeldrucke] → nur Verschieben, bestehende Druck-Specs
  (`DRUCK_SPECS`) bleiben das Netz.
- [Audit vor Bau, Bau scheitert danach] → der Eintrag steht dann ohne gelieferte Daten; das
  ist dieselbe Ordnung wie bei Export und Personenanhang (erst protokollieren, dann liefern) und
  bewusst fail-safe.
- [Bericht in voller Breite sperrt öfter (Personal, Material)] → gewollt („alles oder nichts“,
  abgestimmt); die Sackgasse nennt die Module.

## Migration Plan

Keine Migration. Rückbau: Route und Seite entfernen.
