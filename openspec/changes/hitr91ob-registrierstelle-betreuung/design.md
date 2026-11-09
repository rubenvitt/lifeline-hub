## Context

Motivation: siehe `proposal.md`, „Why“. Abgestimmt mit Ruben am 09.11.2026 (Zunder LLH-1612,
Kommentar „Entscheidungen Ruben“): Belegungsart je Stelle wählbar, Haushalt als Objekt, genau
eine Kostform plus Unverträglichkeiten, Pflicht nur Nachname und Kostform.

Bestand, auf dem der Entwurf aufsetzt:

- `POST …/personen` (`src/routes/einsatz_person.rs:379`, `AnlegenBody`) legt eine Person an, am
  gebundenen Gerät „Betreuungsstelle“ samt Verbleib „Notunterkunft“ an der eigenen Stelle
  (`:968-1000`), mit `client_id` und Replay vor `fordere_aktiv`. Einen Verbleib oder eine
  Stelle nimmt der Body nicht an.
- Verbleib schreibt `verbleib_repo::erfassen_tx` (`src/person/verbleib_repo.rs:128`) und führt
  den Cache `einsatz_person.aktuelle_verbleib_*` nach (`:190-213`). „davon namentlich“ zählt
  `person::repo::namentlich_je_stelle` über diesen Cache.
- Belegung ist append-only in `betreuungsstelle_belegung` (Migration 0117), Zeiger
  `betreuungsstelle.belegung_id`, aktuell über `juengste_meldung!`; Kopfzahl, Stufenlinie,
  Meldeverlauf und der Betreuten-Vorschlag der Verpflegung lesen nur diese Meldungen.
- Die Verpflegung kennt die Kostformen als `Sonderkost` (fünf Zähler, Rest Normalkost,
  `src/verpflegung/mod.rs:108`), im Client `KOSTFORMEN` (`verpflegung/verpflegungText.ts:46`).
- Ein Haushalts- oder Familienbegriff existiert nicht.

## Goals / Non-Goals

**Goals:**
- Aufnahme an der Tür in Sekunden, auch am Gerät und ohne Netz.
- Eine Wahrheit „in Betreuung“: auch bei namentlicher Führung bleibt die Belegungsmeldung die
  einzige Quelle für Kopfzahl, Verlauf und Verpflegung.
- Sonderkost-Bedarf aus echten Angaben statt Schätzung.

**Non-Goals:**
- Personenauskunft, Suchdienst, Abgleich mit Vermisstenmeldungen über das Bestehende hinaus.
- Druck (Registrierkarte, Bändchen, Liste), Zimmer- und Bettenplan.
- Kostform-Katalog der Organisation; ein sechster Wert ist eine additive Änderung (wie
  `Sonderkost`, design.md D1 von LFH-634).
- Kostform-Zählung zu einem früheren Zeitpunkt.

## Decisions

### D1 Registrierte sind Betroffene

Eine registrierte Person ist eine Zeile in `einsatz_person` mit Status `betroffen` und Verbleib
„Notunterkunft“ an der Stelle. Registriernummer, Suche, Sprungpalette, Personen-Detail,
Schwärzung, Aufbewahrung, Zugriffsprotokoll und die Sichtbarkeit am Gerät
(`stelle::sichtbare_personen`) gelten damit ohne Zusatz.
*Alternative:* eigenes Register „Betreute“. Verworfen: zweites Personenregister, doppelte
Schwärzung und Aufbewahrung, Personen in zwei Listen.

### D2 Eigener Schreibweg für die Registrierung

`POST …/betreuung/stellen/{sid}/registrierungen` mit
`{ client_id, zeitpunkt_at?, haushalt_id?, personen: [{ name, vorname?, geburtsdatum?, geschlecht?, herkunft_adresse?, kontakt?, kostform, unvertraeglichkeiten?, notiz? }] }`.
Antwort: der Haushalt mit seinen hier registrierten Personen (Registriernummern). Eine
Transaktion (`write_retry!`): Haushalt anlegen oder laden, je Person
`person::repo::anlegen_tx_mit_optionen` und `verbleib_repo::erfassen_tx` (Notunterkunft, Ziel =
Stelle), dann D5, dann ein ETB-Eintrag. Prüfkette: 403 (Rechte, Module Betreuung und Personen,
Gerät nur eigene Stelle) → Replay über `client_id` (vor `fordere_aktiv`, wie LFH-675/LFH-769) →
404 (Stelle, Haushalt) → 409 (Stelle storniert) → 422 (Stelle geschlossen, Nachname leer, mehr
als 30 Personen) → 400 (Kostform unbekannt, Grenzen). Die Kontaktangabe landet in
`melder_kontakt` (dieselbe Spalte, dieselbe Aufbewahrungskategorie „Personenauskunft“).
*Alternative:* `POST …/personen` um Verbleib, Haushalt und Kostform erweitern und je Person
einzeln senden. Verworfen: ein Haushalt wären n Requests mit n ETB-Einträgen und n
Belegungsmeldungen, und offline könnte ein halber Haushalt ankommen.

### D3 Haushalt als schlanke Tabelle

`haushalt (id, einsatz_id, nummer, bezugsperson_id, angelegt_at, angelegt_von)`, `nummer`
fortlaufend je Einsatz (`UNIQUE (einsatz_id, nummer)`), angezeigt als „H-n“;
`einsatz_person.haushalt_id` (nullable FK). Adresse und Kontakt bleiben an der Person; die
Maske belegt sie nur vor. Der Haushalt kennt keine Stelle: seine Mitglieder stehen dort, wo ihr
Verbleib sie hinführt. Die Bezugsperson ist die erste Person bei der Anlage; ein Wechsel ist
nicht Teil dieser Change.
*Alternative:* Adresse am Haushalt. Verworfen: zwei Orte für dieselbe Angabe, und Schwärzung
und Aufbewahrung müssten eine neue Tabelle kennen.

### D4 Kostform und Unverträglichkeiten an der Person

`einsatz_person.kostform TEXT NULL CHECK (kostform IN ('normal','vegetarisch','vegan','ohne_schwein','diaet_allergenarm','saeugling_kleinkind'))`,
`einsatz_person.unvertraeglichkeiten TEXT NULL` (≤ 200). Wire-Enum `Kostform` per
`wire_enum!`; die fünf Sonderkost-Werte tragen dieselben Schlüssel wie die Felder von
`Sonderkost`, ein Guard-Test hält beide Mengen gleich. Feldweise Änderung über den bestehenden
Personen-PATCH mit Feld-CAS (Spec `personendaten-bearbeiten`). Unverträglichkeiten:
Aufbewahrungskategorie „Behandlung“, Schwärzung leert, nicht im ETB (Änderung als „weitere
Angaben“), nicht im Lagestand. Eine Unverträglichkeit setzt die Kostform nicht von selbst; die
Maske weist bei gefülltem Feld und Normalkost auf „Diät/allergenarm“ hin.

### D5 Namentliche Stelle: der Server meldet die Belegung

`betreuungsstelle.belegungsart TEXT NOT NULL DEFAULT 'gezaehlt' CHECK (… IN ('gezaehlt','namentlich'))`,
`betreuungsstelle_belegung.quelle TEXT NOT NULL DEFAULT 'meldung' CHECK (… IN ('meldung','registrierung'))`.
Eine Funktion `betreuung::repo::belegung_nachfuehren_tx(tx, stelle_id, zeitpunkt, von)` zählt die
nicht stornierten Personen mit aktuellem Verbleib „Notunterkunft“ an der Stelle und schreibt,
nur wenn die Stelle `namentlich` ist und die Zahl von der aktuellen Belegung abweicht, eine
Meldung mit `quelle = 'registrierung'` samt ETB-Meldungseintrag. Aufgerufen wird sie von jedem
Weg, der den Verbleib-Cache einer Person ändert: am Ende von `verbleib_repo::erfassen_tx` für
alte und neue Stelle, beim Storno und bei der Entstornierung einer Person, beim Registrieren
und Abmelden (einmal je Vorgang, nach allen Personen), beim Wechsel der Belegungsart auf
`namentlich`. Handmeldung und Rücknahme an einer namentlichen Stelle: 409. Das Schließen prüft
wie bisher die aktuelle Belegung.
Kopfzahl, Stufenlinie, Meldeverlauf, Übersichtsband und Verpflegung bleiben unverändert, weil
sie nur Meldungen lesen. Der Meldeverlauf zeigt die Herkunft „Registrierung“ und bietet an
solchen Meldungen kein „Zurücknehmen“ an.
*Alternative:* Belegung namentlicher Stellen live aus den Personen rechnen. Verworfen: die
Kopfzahl zu einem Zeitpunkt und die Stufenlinie brauchen Verlauf; sie müssten aus
`person_verbleib` nachgerechnet werden, eine zweite Rechnung für dieselbe Zahl.

### D6 Abmelden als Verbleib „entlassen“

`POST …/betreuung/stellen/{sid}/abmeldungen` mit `{ client_id, zeitpunkt_at?, haushalt_id? , person_ids?, ziel? }`
(genau eins von `haushalt_id`, `person_ids`). Je betroffener Person, die noch an der Stelle
registriert ist, `verbleib_repo::erfassen_tx` mit Art `entlassung` und Ziel; danach D5 und ein
ETB-Eintrag. Prüfkette wie D2. Kein neuer Verbleib-Wert.

### D7 Kostform-Zählung und Vorschlag

`GET …/betreuung/kostformen` → `{ registriert, sonderkost: Sonderkost, ohne_angabe }`, nur Modul
Betreuung (Lesen), kein Personenrecht, keine Personen in der Antwort (Feldmenge in einem Test
gepinnt). Das Band „Kostformen“ der Registrierliste zählt nur die Stelle und rechnet im Client
aus der geladenen Liste. `useBedarfsvorschlag` bekommt eine dritte Quelle `sonderkost`
(Vorschlag je Kostform), nur wenn Betreuung bedienbar ist und `registriert > 0` mit mindestens
einer Sonderkost; der Dialog belegt die Sonderkost-Felder vor wie die beiden anderen, mit
`beruehrt`-Schutz. Hinweis „aus n Registrierten, Stand jetzt“.

### D8 Oberfläche

- Detailseite der Stelle: Abschnitt „Registrierung“ mit Kopfaktion „Registrieren“, Band
  „Kostformen“ und Registrierliste (Haushalte aufklappbar, je Haushalt „Person hinzufügen“ und
  „Abmelden“, je Person „Abmelden“ im Zeilenmenü). Belegungsart in den Stammdaten der Stelle
  (Datenraster), bei `namentlich` trägt „Belegung melden“ den Sperrgrund „Belegung kommt aus der
  Registrierung“.
- Maske `betreuung/registrierung/RegistrierMaske.tsx` auf `ErfassungsModal`. **Kompakt durch
  Aufteilung, nicht durch Einklappen** (Ruben, 09.11.2026): Herkunftsadresse und Kontakt stehen
  einmal je Haushalt oben (gespeichert an jeder Person, D3; eine abweichende Adresse wird
  danach auf der Personen-Detailseite geändert), je Person eine Zeile mit Nachname, Vorname,
  Geburtsdatum, Geschlecht (Segment „m · w · d · ?“), Kostform und Unverträglichkeiten.
  Ab `md` ist die Personenzeile ein Raster mit einer Spaltenkopfzeile (Beschriftung per
  `aria-labelledby` je Feld, nicht nur optisch); darunter je Person ein Block in zwei Spalten,
  Kostform über die ganze Breite. Kostform als Radiogruppe über `personen/FlaechenWahl.tsx` mit
  Kurzwörtern („Normal“, „Veg.“, „Vegan“, „o. Schwein“, „Diät“, „Kleinkind“) und vollem Wort im
  zugänglichen Namen, Wörter aus `KOSTFORMEN` plus „Normalkost“. Tab-Reihenfolge Haushalt →
  Person 1 → Person 2 …, „Person hinzufügen“ setzt den Fokus in den Vornamen der neuen Zeile
  (Nachname vorbelegt), „Entfernen“ je Zeile mit Fokus auf die Zeile davor. Fehler stehen am
  Feld und werden per `aria-describedby` verknüpft. Handschuh-Modus: Trefferhöhe für alle
  Felder und Flächen, die Zeile bricht dann in den Block um.
  *Abweichung:* Das Feldbudget „vier sichtbar, Rest unter ‚Weitere Angaben‘“ der Maske
  „Betroffene erfassen“ (Spec `betroffene-erfassung`) gilt hier ausdrücklich nicht; an der
  Registrierstelle zählt Vollständigkeit ohne versteckte Felder.
- Gerät „Betreuungsstelle“: dieselbe Maske und Liste auf `GeraetBetreuungsstellePage`; die
  Allow-Liste `BETREUUNGSSTELLE` bekommt Registrieren, Abmelden und Kostformen.
- Personen-Detail: Kostform und Unverträglichkeiten als `InlineAngabe` in den Personendaten,
  Haushalt als Lesezeile „Haushalt H-1 · Bezugsperson Weber, Anna“ mit Sprung zur Stelle.
- Offline: neue Queue-Arten `registrierung` und `abmeldung` in `offline/schreiben.ts` mit
  `client_id` und Erfassungszeit; vorgemerkte Haushalte stehen als „vorgemerkt“ oben in der
  Liste und zählen nicht im Band.

## Risks / Trade-offs

- [Verbleibwechsel auf anderen Wegen vergessen D5 aufzurufen → Belegung driftet] → Aufruf
  innerhalb von `verbleib_repo::erfassen_tx` statt in den Routen; Integrationstest je Weg
  (Registrieren, Abmelden, Verbleib-Route, Storno, Entstornierung, Belegungsart-Wechsel).
- [Großer Haushalt offline, Replay nach Stellenschließung] → Replay vor der Zustandsprüfung;
  neu nach Schließung 422 mit Grund am vorgemerkten Eintrag.
- [Sonderkost-Vorschlag größer als die Gesamtzahl bei untergemeldeten gezählten Stellen] → die
  bestehende Prüfung „Sonderkost ≤ Gesamt“ des Dialogs greift; der Hinweis nennt die Zahl der
  Registrierten.
- [ETB-Rauschen durch Meldungen je Registrierung] → eine Meldung je Vorgang, nicht je Person;
  unveränderte Zahl schreibt nichts.
- [Unverträglichkeiten als Gesundheitsdaten] → Kategorie „Behandlung“, Schwärzung, nie im ETB.

## Migration Plan

Eine Migration 0305 (Nummer vor dem Merge gegen `origin/alpha` prüfen,
`scripts/check-migrationen.sh`): Tabelle `haushalt`, drei Spalten an `einsatz_person`, je eine
an `betreuungsstelle` und `betreuungsstelle_belegung`, alle mit Vorgaben, die den Bestand
unverändert lassen (`gezaehlt`, `meldung`, NULL). Kein Datenumbau. Rückweg: Belegungsart auf
`gezaehlt` stellen, die Spalten bleiben ungenutzt.

## Open Questions

- Soll die Bezugsperson eines Haushalts später wechselbar sein? Folgeaufgabe, ändert diese
  Change nicht.
