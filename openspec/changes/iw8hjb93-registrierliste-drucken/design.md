# Design

## Context

Motivation in proposal.md. Bestand, auf dem aufgebaut wird:

- `GET …/betreuung/stellen/{sid}/registrierungen` (`routes/betreuung_registrierung.rs::liste`)
  liefert `RegistrierListe` (Haushalte nach Nummer, Personen nach Registriernummer, Block
  `ohne_haushalt`) inklusive `unvertraeglichkeiten`. Gate `EinsatzLesezugriff<Betreuung>` plus
  `fordere_modul_zugriff("personen")`, Gerät über `fordere_eigene_stelle` (fremd 403). Der Abruf
  ist unprotokolliert und live (`einsatzKeys.registrierliste`).
- Personendaten werden nur über protokollierte Abrufe gedruckt (`frontend/src/druck/AGENTS.md`,
  „Personendruck nur über …“): `GET …/personen/druck` schreibt einen listenweiten Eintrag,
  `GET …/personen/{pid}/druck` einen mit Person. `person_zugriff_audit` erlaubt `druck` mit
  `person_id` bereits (Migration 0141); Gerätekonten haben eine `benutzer`-Zeile.
- Die Personendruckansicht (`pages/PersonDruckPage.tsx`) ist das Muster der Seite:
  `DRUCK_ABFRAGE`, eigener nicht-live Key, `gcTime: 0`, „Neu laden“, `DruckKnopf`, eine
  Druckwurzel mit `Druckkopf`.
- Das Band „Kostformen“ rechnet `kostformBand` (`betreuung/registrierung/registrierKern.ts`);
  Namen, Alter und Kostformwörter kommen ebenfalls von dort.
- Das Gerät „Betreuungsstelle“ zeigt das `RegistrierungPaneel` im Bereich „Registrierung“
  (`geraet/GeraetBetreuungsstellePage.tsx`) und darf `/api/organisation` samt Logo lesen; der
  Druckkopf trägt also auch dort.

## Goals / Non-Goals

**Goals:**

- Ein Blatt, das an der Stabsoberfläche und am Gerät gleich aussieht und gleich protokolliert.
- Gesundheitsangaben verlassen den Server nur, wenn sie für den Druck gewählt sind.

**Non-Goals:**

- Registrierkarte je Haushalt, Bändchen, Zimmer- und Bettenplan, Unterschriftenliste.
- Druck über mehrere Stellen hinweg (eine Liste je Stelle).
- Adresse und Kontakt der Haushalte auf dem Blatt (nicht beauftragt; mehr Personendaten auf
  Papier als nötig).
- Protokollierung der bestehenden Bildschirmliste.

## Decisions

### D1 Eigener protokollierter Abruf statt der Bildschirmliste

`GET /api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen/druck`, Antwort
`RegistrierListe` (dasselbe DTO, keine neue Typ-Generierung außer dem Pfad). Gate und
Prüfreihenfolge wie `liste`: Extractor `EinsatzLesezugriff<Betreuung>` (ADR-0005) →
`fordere_eigene_stelle` (403) → Modul Personen (403) → Stelle unbekannt oder fremd (404) →
lesen und protokollieren.

*Alternative:* die Bildschirmliste wiederverwenden und clientseitig drucken — verworfen, weil
der Druck dann nicht protokolliert wäre (Regel Personendruck) und der Live-Cache das Blatt
während des Druckens verändern könnte.

### D2 Protokoll je Person, in einer Transaktion vor der Antwort

Abgestimmt mit Ruben (09.11.2026): je gedruckter Person ein Eintrag `druck` mit `person_id`,
nicht ein listenweiter. Ein listenweiter Eintrag erschiene über das Erfassungsfenster bei jeder
Person des Einsatzes (`audit_repo::liste_je_person`), auch an anderen Stellen; je Person ist
genau. Ablauf: Transaktion öffnen, Liste in der Transaktion lesen (dieselbe Abfrage wie
`registrierung::liste`, als Variante über einen `Executor`), je Person `INSERT` in
`person_zugriff_audit`, Commit, dann die Antwort. Scheitert ein Insert oder der Commit, geht
keine Person hinaus und kein Eintrag bleibt stehen. Leere Stelle: keine Einträge (es wird
niemand gedruckt). `audit_repo` bekommt dafür eine Variante `anlegen_tx`.

*Alternative:* ein listenweiter Eintrag wie bei `…/personen/druck` — verworfen (siehe oben).

### D3 Unverträglichkeiten nur mit `?unvertraeglichkeiten=1`

Query-Parameter `unvertraeglichkeiten` (`true`/`1`, sonst aus). Ohne ihn setzt der Server das
Feld jeder Person auf `None`; durch `skip_serializing_if` fehlt es in der Antwort. Die Wahl
reist in der Adresse der Druckseite (`?unvertraeglichkeiten=1`), damit „Neu laden“ und ein
geteilter Link dieselbe Fassung zeigen. Ein Wechsel des Schalters ist ein neuer Abruf und damit
ein neuer Protokolleintrag je Person — gewollt, denn er liefert andere Daten.

### D4 Druckseite und Blatt

- Pfad Stab: `/einsaetze/:id/betreuung/:stelleId/registrierliste/druck`
  (`registrierlisteDruckPfad` in `routing/deeplinks.ts`). Pfad Gerät:
  `/geraet/:id/betreuung/registrierliste/druck` — die Stelle ist die gebundene, sie steht nicht
  in der Adresse. Beide über einen neuen Eintrag `registrierlisteDruck` in `EinsatzPfade`
  (Stab mit Stelle, Gerät ohne), damit das geteilte Paneel nicht nach Oberfläche verzweigt.
- Seite `betreuung/registrierung/RegistrierlisteDruckSeite.tsx` (geteilt), Muster
  `PersonDruckPage`: Abfrage mit `DRUCK_ABFRAGE`, Key `einsatzKeys.registrierlisteDruck(eid, sid,
  mitUnvertraeglichkeiten)` unter neuem, nicht-live Prefix, `gcTime: 0`. Zustände: laden, Fehler
  mit „Erneut laden“, 403 „Kein Zugriff auf die Personen“, 404 „Stelle nicht gefunden“, leer
  „Niemand registriert“ ohne Druckknopf. Am Bildschirm über der Druckwurzel: Schalter
  „Unverträglichkeiten mitdrucken“ und der Hinweis, dass der Abruf protokolliert wird (nie auf
  Papier). Die Stabsseite liest die Stellenbezeichnung aus `einsatzKeys.betreuung`, das Gerät aus
  seinem Rahmen.
- Blatt `betreuung/registrierung/RegistrierlisteBlatt.tsx`: schlichte `<table>`-Elemente (keine
  antd-Tabelle). EINE Tabelle mit einem Kopf für alle, damit die Spalten über alle Haushalte gleich
  breit bleiben; je Haushalt ein `tbody` mit Kopfzeile „H-n · Bezugsperson · n Personen“, der im
  Druck nicht bricht (`registrierlisteDruck.css`; ein Haushalt hat höchstens 30 Personen). Ein
  Titelblock je Haushalt mit eigener Tabelle hätte die Spaltenbreiten je Haushalt springen lassen.
  Spalten „Reg.-Nr.“, „Name“, „Geb. / Alter“, „Kostform“,
  optional „Unverträglichkeiten“, „✓“ (leer, schmal, mit Rand). Summen oben als kleine Tabelle
  aus `kostformBand` in der Reihenfolge `KOSTFORM_REIHE` plus „ohne Angabe“ und „gesamt“.
  Schwarz auf Weiß, keine Farbe als Bedeutungsträger.
- Druckkopf: `dokumentart="Registrierliste"`, Titel = Stellenbezeichnung, Zeilen „Stand“,
  „Umfang“ („2 Haushalte · 5 Personen“) und bei Wahl „Gesundheitsangaben: mit“.
- Einstieg: Knopf „Registrierliste drucken“ im `aktion`-Slot des `RegistrierungPaneel`, nur
  wenn `personenFrei`, unabhängig von `darfSchreiben`. Er navigiert (kein eigener Druckdialog).

### D5 Gerät „Betreuungsstelle“

Route `("GET", "/api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen/druck")` in die
Routenliste der Betreuungsstelle (`src/geraet/mod.rs`), Test in `tests/geraet_kopplung.rs`
(eigene Stelle 200, fremde 403 ohne Protokoll, UHS-Gerät 403). Client: `geraetDarf` bekommt
`registrierliste-druck`, wahr nur für die Betreuungsstelle; die Geräteroute hängt im
`GeraetBetreuungRahmen`. Begründung der Ausnahme zu „Personendruck nie am Gerät“: die
Notunterkunft arbeitet am Gerät, die Liste ist auf die eigene Stelle begrenzt und je Person
protokolliert. `person-druck` bleibt am Gerät falsch.

## Risks / Trade-offs

- [Viele Protokollzeilen bei großen Stellen: 300 Personen × mehrfaches Neu laden] → bewusst
  hingenommen; Inserts in einer Transaktion sind billig, und das Protokoll soll genau sein.
- [Druck aus dem Gerät-Tablet ohne Drucker] → „als PDF“ bleibt möglich; kein eigener Weg nötig.
- [Unverträglichkeiten im Browser-Cache] → `gcTime: 0` und eigener Key je Fassung; die Liste
  liegt nie auf der Platte (Key nicht in `offline/lagebildKuerzung.ts`-Allowlist).
- [Lange Haushalte über Seitengrenzen] → Kopfzeile je Tabelle wiederholt (`thead`), Titelblock
  hält Haushaltskopf und erste Zeile zusammen (`druck/AGENTS.md`, LFH-1008).
