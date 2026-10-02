# Proposal

## Why

Heute hat jeder Einsatz genau eine Aufbewahrungsfrist. Läuft sie ab, sperrt das System den
ganzen Einsatz und schwärzt nach der Karenz alle personenbezogenen Spalten auf einmal. Die
Recherche zu LFH-749 (ClickUp-Kommentar vom 02.10.2026) zeigt, dass die Rechtslage das nicht
trägt. Die Registrierung für die Personenauskunft muss in NRW nach höchstens einem Monat
gesperrt sein (§ 46 Abs. 6 BHKG). Behandlung und Sichtung sind dagegen Behandlungsdokumentation
und laufen eher zehn Jahre (§ 630f Abs. 3 BGB, Landesrettungsdienstgesetze). Beide Zwecke hängen
an derselben Personenzeile. Eine einzige Frist ist für den einen Zweck zu lang oder für den
anderen zu kurz. Die Fristen hängen außerdem vom Land und vom Verantwortlichen ab: bei JUH und
MHD gilt zusätzlich kirchliches Datenschutzrecht. Feste Werte im Code scheiden damit aus.

## What Changes

- **Fristkategorien.** Drei Kategorien bekommen eigene Fristen: **Behandlung**, **Personenauskunft**
  und **Bildaufnahmen**. Für alles andere gilt weiter die Einsatz-Frist, das ETB und die
  Triage-Kategorie eingeschlossen. Jede Scrub-Regel der Schwärzungs-Registry trägt genau eine
  Fristkategorie, mit `einsatz` als Vorgabe. Ein Guard-Test hält das fest.
- **Identität folgt dem längsten Zweck.** Name, Vorname, Geschlecht, Geburtsdatum und das
  geschätzte Alter einer Person folgen der Personenauskunft. Wurde die Person gesichtet oder in
  einer UHS belegt, gilt die spätere der Fristen von Personenauskunft und Behandlung.
- **Fristen je Organisation.** Der Org-Admin stellt je Kategorie eine Dauer in Tagen ein und
  begründet sie mit einem Freitext „Rechtsgrundlage“, der dann Pflicht ist. Die Oberfläche
  nennt Vorschlagswerte mit Quelle. Es gibt keinen Default, der still schwärzt: ohne
  eingestellte Dauer folgt die Kategorie der Einsatz-Frist wie heute.
- **Frist beim Abschluss einfrieren.** Beim Abschluss schreibt das System je eingestellte
  Kategorie die Frist mit Dauer und Rechtsgrundlage an den Einsatz und hält das im ETB fest.
  Spätere Änderungen der Org-Einstellung wirken nur auf künftige Abschlüsse.
- **Zwei Stufen je Kategorie.** Ist die Frist einer Kategorie abgelaufen, gilt sie als
  **gesperrt**. Ihre Werte lesen sich auf allen Wegen so, als wären sie schon geschwärzt, der
  Einsatz bleibt dabei lesbar. Bilder fehlen in den Listen, und ihr Abruf liefert 404. Nach
  30 Tagen Karenz **schwärzt** der Purge-Lauf die Kategorie unwiderruflich. Jeder Schritt steht
  im ETB.
- **Wiederherstellen je Kategorie.** In der Karenz kann der Org-Admin eine Kategorie in der
  Archivakte wiederherstellen, mit neuer Frist oder ohne. Ohne Frist folgt die Kategorie wieder
  der Einsatz-Frist.
- **Einsatz-Frist bleibt die äußere Grenze.** Eine Kategorie-Frist nach der Einsatz-Frist wirkt
  nicht, weil dann der ganze Einsatz gesperrt und geschwärzt wird. Sperre und Schwärzung des
  Einsatzes bleiben unverändert.
- **Zustand und Akte.** Archivübersicht, Archivakte und die Aufbewahrung in den
  Einsatz-Einstellungen zeigen je Kategorie Frist, Rechtsgrundlage und Zustand. Die
  Personenansicht nennt eine Sperre als Grund für leere Felder.
- **Höchstdauer 3660 statt 3650 Tage**, für den Einsatz, die Org-Vorgabe und die Kategorien.
  Zehn Jahre mit Schalttagen passen sonst nicht hinein.

**Nicht in dieser Change** (Folgetickets): die Kategorie **Einsatzkräfte** (externe Helfer,
Stabsfunktion, Notizen der Kräfte-Zeitachse). Sie wird über rund zwölf unabhängige SELECTs
gelesen und bleibt bis dahin bei der Einsatz-Frist. Ebenfalls nicht enthalten sind eine
Kategorie-Frist, die je Einsatz abweicht, und eine Kategorie, die die Einsatz-Frist überdauert.

## Capabilities

### New Capabilities

- `aufbewahrung-kategorien`: Fristen je Datenkategorie. Umfasst die Kategorien und ihren
  Spalten-Zuschnitt, die Identitätsregel, die Org-Einstellung mit Rechtsgrundlage, das
  Einfrieren beim Abschluss, Sperre und Schwärzung je Kategorie, das Wiederherstellen in der
  Karenz und die Anzeige von Zustand und Sperre.

### Modified Capabilities

- `aufbewahrung`: Jede Scrub-Regel der Klassifikation trägt genau eine Fristkategorie. Die
  Auslöser umfassen Sperre und Schwärzung je Kategorie im Purge-Lauf. Der Audit-Pflicht
  unterliegen auch die Kategorie-Mutationen.
- `aufbewahrung-archiv`: Der Archiv-Namensraum bekommt einen zweiten Schreibweg, das
  Wiederherstellen einer Kategorie. Die Archivakte zeigt die Kategorien mit Zustand.

## Impact

- **Backend:**
  - `src/einsatz/schwaerzung_registry.rs`: Fristkategorie je Scrub-Regel, Zeilenfilter für
    Bildaufnahmen, Guard-Test.
  - `src/einsatz/retention.rs` (Zustand je Kategorie), `src/einsatz/purge_scheduler.rs` (zwei
    neue Phasen), `src/einsatz/repo.rs` (Abschluss, Kategorie-Sperre und -Schwärzung).
  - Lesewege: `src/person/*_repo.rs`, `src/uhs/belegung_repo.rs`, `src/routes/support.rs`
    (`anhang_antwort`) und die Anhang-Metadatenlisten in Chat, ETB, Schaden und Dokument.
  - `src/org/einstellungen.rs` und `src/routes/org_einstellungen.rs`, dazu
    `src/aufbewahrung/*` und `src/routes/aufbewahrung.rs`.
- **Migration:** zwei neue Tabellen. `org_aufbewahrung_kategorie` hält die Einstellung je Org,
  `einsatz_aufbewahrung_kategorie` den eingefrorenen Stand je Einsatz und Kategorie.
- **API:**
  - neue Routen `GET/PUT /api/org-einstellungen/aufbewahrung-kategorien`,
    `GET /api/einsaetze/{id}/aufbewahrung/kategorien` und
    `POST /api/aufbewahrung/einsaetze/{id}/kategorien/{kategorie}/wiederherstellen`
  - neue Felder in den Archiv-DTOs
  - Typ-Codegen für `openapi.json` und `types.generated.ts`
- **Frontend:** `pages/einstellungen/EinsatzDefaults.tsx` (Org-Fristen),
  `pages/einstellungen/EinsatzAufbewahrung.tsx`, `aufbewahrung/ArchivAktePage.tsx` und
  `aufbewahrung/AufbewahrungUebersicht.tsx`, dazu der Sperrhinweis in der Personenansicht.
- **Regeln:** `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung“, bekommt die Kategorie-Regeln.
