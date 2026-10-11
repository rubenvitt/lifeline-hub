## Context

Warum die Change nötig ist, steht in `proposal.md`. Was gelten soll, steht in den Specs
(`stammdaten-externe-stellen`, `org-live`, `eingabegrenzen`). Bestand, auf dem der Entwurf
aufsetzt (Scope-Scan 11.10.2026):

- **Org-Kataloge** gibt es in drei Bauformen. Der Stichwort-Katalog (`src/stichwort/`) ist der
  einfachste: nur Text, hartes Löschen, keine Grenzen. Die ETB-Bausteine (`0037`,
  `src/etb_baustein/`, `src/routes/etb_baustein.rs`) haben eine Aufzählung, `aktiv`, Tri-State-PATCH
  und Soft-Delete. Die Sprechgruppen (`0073`, `src/sprechgruppe/`) haben dazu `?nur_aktive=` und
  Grenzen (`BEDINGUNG_MAX`), bringen aber einsatz-lokale Zeilen und M:N-Zuordnungen mit.
- **Live:** Die Middleware `stammdaten_live` (`src/routes/live.rs`) verteilt `stammdaten` nach
  jeder erfolgreichen Schreibanfrage unter einem Präfix aus `STAMMDATEN_PFADE`. Der Wächter
  `tests/stammdaten_live_guard.rs` gleicht Präfixe und Katalogmodule ab.
- **Rechte:** Kataloge schreibt `AdminUser` (System-Admin), lesen darf `CurrentUser`. Eine
  eigene Org-Admin-Rolle gibt es nicht.
- **Meldende Stelle:** Spalte `einsatz.meldende_stelle`, geschrieben nur über
  `PATCH /api/einsaetze/{id}` (`trimme_tri`, ohne Grenze). Schwärzung `NullSetzen`. In der
  Frist-Antwort und im Lagemonitor ausgeblendet. Im Frontend `TextAngabe` (Zeile) und `Input`
  (Vollformular) in `pages/EinsatzdatenPage.tsx`. Daneben steht schon ein `AutoComplete` für das
  Stichwort, als `InlineAngabe` gebaut.
- **Nachforderung:** `nachforderungen/NachforderungFormular.tsx`. Die Kategorie ist mit
  `leitstelle` vorbelegt, die Bezeichnung ist ein `Input` mit `ETB_PARTEI_MAX` (500). Die Hülle
  setzt nach jedem Absetzen auf `initialValues` zurück; „Werte behalten“ übernimmt Kategorie und
  Bezeichnung.
- Den Baustein `StammdatenFeld` (LFH-1284) gibt es noch nicht (Entscheidung Ruben 11.10.2026:
  jetzt mit `AutoComplete`, LFH-1284 stellt später um).

## Goals / Non-Goals

**Goals:**
- Einen schlanken Org-Katalog nach dem Muster der ETB-Bausteine bauen, ohne die Last der
  Sprechgruppen.
- Die Vorschlagslogik für externe Stellen genau einmal bauen (Gruppierung, Teilwortsuche) und
  von Einsatzdaten und Nachforderung gemeinsam nutzen, damit LFH-1284 sie an einer Stelle
  übernimmt.

**Non-Goals:**
- Kein Verweis vom Einsatz oder von der Nachforderung auf den Katalog (Speicherform A).
- Kommunikationsplan S6 und Lücke „Leitstelle“: eigenes Ticket.
- Kein allgemeines Vorschlagsfeld mit Quellen-Adaptern, Marke „frei“ oder „In Stammdaten
  übernehmen“: das baut LFH-1284.
- Keine Startliste und keine Demo-Zeilen. Die Stellen jeder Organisation sind verschieden, und
  Demo-Daten legen nach `src/demo/katalog.rs` keine Katalogeinträge an.

## Decisions

### D1 Speicherform A: nur Text am Einsatz
Gespeichert bleibt nur `einsatz.meldende_stelle` als Text (Entscheidung Ruben 11.10.2026).
**Warum:** Der Text ist eine Momentaufnahme dessen, was gemeldet wurde. Eine Umbenennung oder
Deaktivierung im Katalog darf einen abgeschlossenen Einsatzbericht nicht ändern. Es gibt keinen
Fremdschlüssel, also auch keine Löschfolgen und keine neue Schwärzungsklassifizierung.
**Verworfen:** B, Text plus `meldende_stelle_id`. Das erlaubte Auswertungen „Einsätze je
Leitstelle“, kostet aber eine Migration am Einsatz, eine Löschregel und eine Klassifizierung in
der Schwärzungs-Registry. Diese Auswertung verlangt heute niemand. Kommt sie, kann LFH-1284 die
Referenz (`ref`) mitbringen.

### D2 Eigene Aufzählung `ExterneStelleArt`
Werte `leitstelle`, `behoerde`, `polizei`, `hilfsorganisation`, `sonstige` als `wire_enum!` mit
`ToSchema`, CHECK in der Migration und Eintrag in `tests/enum_wire_kontrakt.rs` (Entscheidung
Ruben 11.10.2026).
**Verworfen:** die `Stellenart` des Kommunikationsplans wiederzuverwenden. Sie beschreibt die
Rolle im Plan (`funktion`, `verbindungsperson`) und kennt weder Polizei noch
Hilfsorganisation. Das spätere Kommunikationsplan-Ticket bildet ab: `polizei` → `behoerde`,
`hilfsorganisation` → `sonstige`, sonst gleich.
**Reihenfolge** der Gruppen in Tabelle und Vorschlägen: Leitstelle, Polizei, Behörde,
Hilfsorganisation, sonstige. Innerhalb einer Gruppe erst die zuständige Leitstelle, dann
alphabetisch.

### D3 Tabelle `org_externe_stelle` und die zuständige Leitstelle
Migration `0176_org_externe_stelle.sql`:

```
id, org_id → organisation, bezeichnung TEXT NOT NULL, art TEXT NOT NULL CHECK(...),
rufnummer TEXT, funkrufname TEXT, aktiv INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0,1)),
zustaendig INTEGER NOT NULL DEFAULT 0 CHECK (zustaendig IN (0,1)),
CHECK (zustaendig = 0 OR (art = 'leitstelle' AND aktiv = 1)),
erstellt_at, aktualisiert_at, UNIQUE(org_id, bezeichnung)
CREATE UNIQUE INDEX idx_org_externe_stelle_zustaendig ON org_externe_stelle(org_id) WHERE zustaendig = 1;
```

Kopfkommentar wie bei `0128` (`org_fuehrungsfunktion`): Org-Stammdatum, nicht einsatzbezogen,
deshalb nicht in der Schwärzungs-Registry.

**Markierung wechseln:** Ein PATCH mit `zustaendig: true` setzt in einer Transaktion erst alle
Stellen der Organisation auf `zustaendig = 0` und dann die gewählte auf 1. Der Index ist das
Netz, die Transaktion der Weg. Geprüft wird der **Zustand nach dem Patch** (Art und Aktiv aus
Patch oder Bestand). Ist die Stelle dann zuständig, aber keine aktive Leitstelle, folgt 422 mit
Klartext. `aktiv: false` setzt `zustaendig` in derselben Anweisung auf 0 (Spec: Deaktivieren
entfernt die Markierung). Gesendetes `aktiv: false` und `zustaendig: true` zusammen ist 422.
Der CHECK fängt einen Fehler im Rust-Code als 500, nicht als stille Datenlage.
**Verworfen:** 409, wenn schon eine andere Stelle zuständig ist. Das zwänge zu zwei Klicks
(alte abwählen, neue wählen), ohne etwas zu schützen.
**Verworfen:** eine Spalte `zustaendige_leitstelle_id` an `organisation`. Das wäre ein zweiter
Schreibweg (Org-Einstellungen, enger Lesekreis, nicht live) und bräuchte eine Löschregel.

### D4 API und Rechte
- `GET /api/externe-stellen?nur_aktive=` (`CurrentUser`, Vorgabe `true`). Die Antwort ist
  sortiert nach D2. Die Verwaltung ruft mit `nur_aktive=false`.
- `POST /api/externe-stellen` (`AdminUser`): 201 mit `ExterneStelle`.
- `PATCH /api/externe-stellen/{id}` (`AdminUser`): Tri-State wie ETB-Bausteine.
  `bezeichnung` und `art` sind optional, aber nicht leer. `rufnummer` und `funkrufname` sind
  Tri-State (`null`/`""` leert). `aktiv` und `zustaendig` sind optionale Wahrheitswerte. Fremde
  oder unbekannte id → 404.
- Kein DELETE. Der Admin deaktiviert und reaktiviert über `aktiv`, nicht über ein eigenes
  `/deaktivieren` wie bei den ETB-Bausteinen, denn hier geht es in beide Richtungen.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“: leer, unbekannte Art und Überlänge
  → 400, Duplikat → 409 (UNIQUE), unzulässige Markierung → 422.
- **Lesekreis:** Rufnummer und Funkrufname einer Behörde sind Dienstkontakte, keine
  personenbezogenen Daten. Jeder Angemeldete der Organisation darf lesen, wie bei den
  Stichworten. Die Einsatzdaten brauchen die Liste ohnehin.
- Antwort-DTO `ExterneStelle { id, bezeichnung, art, rufnummer?, funkrufname?, aktiv,
  zustaendig }` mit `ToSchema` in `src/api_doc.rs`. Optionale Felder werden mit
  `skip_serializing_if` weggelassen (Regel Typ-Codegen). Request-DTOs pflegt das Frontend von
  Hand.

### D5 Grenzen
`EXTERNE_STELLE_BEZEICHNUNG_MAX = 200`, `EXTERNE_STELLE_KURZ_MAX = 100` (Rufnummer,
Funkrufname), `MELDENDE_STELLE_MAX = 200`. Alle drei werden in `api/eingabegrenzen.ts`
gespiegelt und in `tests/eingabegrenzen_spiegel.rs` eingetragen.
**Warum 200 für die meldende Stelle:** Jede Bezeichnung aus dem Katalog passt hinein, und 200
entspricht `AUFTRAG_EXTERN_BEZEICHNUNG_MAX`. Die Grenze gilt nur für den gesendeten Wert
(`optional_max` auf dem Tri-State-Zweig `Some(Some(_))`). Ein längerer Altwert stört andere
Patches nicht, weil die Zeile ihn nur sendet, wenn er sich ändert.
**Die Adressat-Bezeichnung** der Nachforderung behält `ETB_PARTEI_MAX` (500). Jede
Katalogbezeichnung passt hinein.

### D6 Ein Vorschlags-Hook für beide Abnehmer
Neues Modul `stammdaten/externeStellenVorschlaege.ts(x)`:
- `useExterneStellen()` liest `GLOBAL_KEYS.externeStellen` mit `nur_aktive=true`.
- `externeStellenOptions(stellen)` liefert gruppierte `AutoComplete`-Optionen
  (`{ label: 'Leitstelle', options: [{ value: bezeichnung, label }] }`). Die zuständige
  Leitstelle trägt die Marke „zuständig“ als Wort.
- Gefiltert wird per Teilwortsuche, ohne Rücksicht auf Groß- und Kleinschreibung (Logik wie
  `components/teilwortSuche.ts`, angepasst an `AutoComplete.filterOption`).
- `zustaendigeLeitstelle(stellen)` liefert die Bezeichnung oder `undefined`.

**Warum ein eigenes Modul statt Inline wie beim Stichwort:** Zwei Abnehmer, und LFH-1284 macht
daraus die Quelle `externeStellen`. Dann muss nur eine Datei umziehen.
**Verworfen:** jetzt schon einen kleinen Teil von `StammdatenFeld` bauen. Das ist ohne eigene
Change eine Regel (E2) durch die Hintertür.

### D7 Einsatzdaten
- Die Zeile „Meldende Stelle“ wechselt von `TextAngabe` auf `InlineAngabe<string>` mit
  `AutoComplete`, nach dem Muster der Stichwort-Zeile (`gleich` vergleicht getrimmt, leer wird
  `null`). `TextAngabe` bleibt für die übrigen Freitexte. Ihr Kommentar „Stichwort ausgenommen“
  nennt dann auch die meldende Stelle.
- Das Vollformular „Meldende/anfordernde Stelle“ bekommt dasselbe `AutoComplete`.
- Beide tragen `maxLength={MELDENDE_STELLE_MAX}`. Das ist ein kurzes, einzeiliges Feld,
  also natives `maxLength` (Erfassungs-Norm).

### D8 Nachforderung: Vorbelegung ohne Überschreiben
- `adressatBezeichnung` wird ein `AutoComplete` mit den Optionen aus D6.
- `initialValues.adressatBezeichnung` ist die zuständige Leitstelle, sonst `''`. Damit belegt
  auch der Reset nach dem Absetzen wieder vor.
- Die Liste kommt asynchron. Deshalb belegt ein Effekt nach, sobald die zuständige Leitstelle
  bekannt ist: nur wenn die Kategorie `leitstelle` ist, das Feld leer ist und es noch nicht
  berührt wurde (`form.isFieldTouched`).
- Wechselt die Kategorie auf `leitstelle` und ist das Feld leer, wird ebenfalls vorbelegt. Ein
  Wechsel weg von `leitstelle` lässt das Feld stehen; die Person sieht ihren Wert.
- Ein Deeplink mit Vorbelegung (`vorbelegung`) setzt die Adressat-Bezeichnung nicht. Er bleibt,
  wie er ist.

### D9 Query-Key, Live, Offline
- `GLOBAL_KEYS.externeStellen` (Wire-String `externe-stellen`), Accessor mit Token
  `'aktiv' | 'alle'` als zweitem Element. Der argumentlose Accessor ist der
  Invalidierungs-Präfix (Muster `personalListe`).
- Klasse: live über `ORG_STREAM_EVENTS.stammdaten`.
- **`LAGEBILD_OFFLINE`: ausdrücklich draußen**, der Kommentar in `api/queryKeys.ts` nennt den
  Grund. Ohne Netz bleibt die meldende Stelle als Freitext erfassbar; der Katalog ist eine
  Komfortquelle, keine Rahmenangabe einer Lagebild-Ansicht. Rufnummern gehören nicht ohne Not auf
  die Platte eines Geräts.

### D10 Verwaltung
`stammdaten/ExterneStellenTab.tsx` mit `KatalogTabelle`, Spalten Bezeichnung, Art, Rufnummer,
Funkrufname, Zustand. Filterachsen Art und aktiv/inaktiv, damit keine Ausnahme in
`katalogTabelle.guard.test.ts` nötig ist. Marke „zuständig“ als Wort.
`stammdaten/ExterneStelleFormModal.tsx` mit `ErfassungsModal`. Nach dem Feldbudget (≤ 3
sichtbare Felder) sind Bezeichnung und Art sichtbar. Bei Art „Leitstelle“ kommt die Checkbox
„Zuständige Leitstelle“ dazu. Rufnummer und Funkrufname liegen im Klappteil „Rufnummer und
Funkrufname“. Den Begriff „Erreichbarkeit“ meiden wir (LFH-1274).
Aktivieren/Deaktivieren über das Aktionsmenü der Zeile.
`SchnellAnlegen` passt nicht, weil Art Pflicht ist und neben der Bezeichnung steht.
Eintrag in `admin/adminNav.tsx` nach den Stichworten. Rechteanzeige mit
`STAMMDATEN_RECHTE_TEXT`.

## Risks / Trade-offs

- [Zwei Vorschlagsorte, ehe LFH-1284 kommt] → Die Logik liegt in einem Modul (D6), die
  `AutoComplete`-Hülle ist an beiden Stellen dünn. LFH-1284 bekommt im Ticket einen Kommentar,
  dass Einsatzdaten und Nachforderung umzustellen sind.
- [Die neue Grenze für die meldende Stelle könnte einen bestehenden Arbeitsablauf brechen] →
  Bisher gab es im Frontend nur ein `Input` ohne Grenze, und 200 Zeichen reichen für eine
  Stelle. Altwerte bleiben (Szenario in `eingabegrenzen`).
- [Vorbelegung in der Nachforderung überrascht] → Nur bei leerem, unberührtem Feld und Kategorie
  „Leitstelle“. Der Wert steht sichtbar im Feld und lässt sich vor dem Absetzen ändern.
- [Markierung wechselt still von einer Stelle auf eine andere] → Die Tabelle zeigt die Marke
  „zuständig“ sofort live; im Modal sagt der Hilfetext der Checkbox, dass die bisherige
  Markierung entfällt.

## Migration Plan

- Migration `0176` legt nur die neue Tabelle an. Es gibt keine Daten zu übernehmen. Vor dem
  Push `scripts/check-migrationen.sh` gegen `origin/alpha` laufen lassen (Nummer kann sich bis
  zum Merge verschieben).
- Rücknahme: Der Katalog ist für sich. Ohne ihn fallen die Vorschläge weg, und die Felder
  bleiben Freitext.
