# Design

## Context

Motivation: siehe `proposal.md`. Die Grenzen des medizinischen Umfangs, die Kataloge, die
Kategorie „Behandlung“, die ETB-Regel und die Figur je Geschlecht sind entschieden (Change
`openspec/changes/archive/2026-10-18-juo02hfm-medizinischer-umfang/design.md`, Punkte 1 bis 9).
Hier geht es nur um das Wie.

Ausgangslage im Code, Stand `alpha` (da5f25ce):

- **Medizinische Einträge** sind anhängende Tabellen, jeweils mit eigenem POST unter
  `…/personen/{pid}/…` (`src/routes/einsatz_person.rs`):
  - `person_sichtung` mit Cache `aktuelle_sichtung` und Bestätigung (`sichtung_repo.rs:35-84`),
  - `person_verbleib` mit Cache-Spalten (`verbleib_repo.rs:70-113`),
  - `person_verlaufsnotiz` (`verlaufsnotiz_repo.rs:22-44`).
- **Der Cache folgt der Einfügereihenfolge.** Keine der drei Tabellen kennt `client_id`. Eine
  Erfassungszeit aus dem Body nimmt keine an (E-2, Annahme 9).
- **Ohne Netz schreiben** bisher nur Anlegen, Belegung, Meldung, Stand und Verpflegung
  (`frontend/src/offline/schreiben.ts`). Vorbild für Idempotenz und „jüngster Zeitpunkt gewinnt“
  ist die Belegungsmeldung der Betreuung (`routes/betreuung.rs:553-594`,
  `betreuung/repo.rs:128-145`, `nachtrag_gegen` :798-809). Die Kappung macht
  `support::meldezeitpunkt` (`routes/support.rs:66-94`).
- **Aufbewahrung**: Jede Personentabelle muss stehen in
  - `TABELLEN`,
  - `BEHANDLUNGSBEZUG_TABELLEN` (`schwaerzung_registry.rs:2786`, Guard :3606),
  - `PERSONENBEZUEGE` (`schwaerzung_person.rs:127ff`).

  Die Kategorie je Scrub-Spalte pinnt `kategorie_zuordnung_ist_gepinnt` (:3449-3572). Die
  Ausnahmeliste der ETB-Scrubwerte sperrt `einsatz_person.*` und `person_*.*`
  (`tests/aufbewahrung_e2e.rs:52-58`).
- **Gerät**: Die Schranke ist eine Routenliste je Ansicht (`src/geraet/mod.rs:245-307`). Die
  Bestätigung löst `geraet::bestaetigung::aufloesen` auf. Die Patientenansicht am UHS-Gerät ist
  die geteilte `PersonenDetailPage`, die Schnellansicht nutzt `Patientenkopf modus="lesen"`.
- **Patientenkopf** (`frontend/src/personen/Patientenkopf.tsx`): ein Datenraster mit vier
  Feldern und Paneelen für Sichtung und Verbleib, der Wechsel ist gesperrt, solange gespeichert
  wird. Bei 1280 × 800 muss alles ohne Bildlauf stehen (Spec `personen-detail`).
- **Höchste Migration** ist 0216.

## Goals / Non-Goals

**Goals:**
- ein Bauplan für alle neuen medizinischen Einträge: Tabelle, POST, Aufheben, Gerät, Bestätigung,
  Erfassungszeit, Idempotenz, Aufbewahrung, Leak-Schutz
- ein Ort für die Regel „jüngster Stand gewinnt“, gleich für Sichtung, Verbleib und Transport
- Patientenkopf mit vollem PAT-Kern ohne Bildlauf bei 1280 × 800

**Non-Goals:**
- Vitalwerte, Kurzbefund, Krankenhaus-Stamm (LLH-1109, verworfen)
- Erst-Sichtung beim offline vorgemerkten Anlegen mit Erfassungszeit (eigene Folgeaufgabe)
- Belegungszüge im Grundriss ohne Netz (bleiben online)
- Grenzen für die bestehenden Personen-Freitexte (Notiz, PATCH-Felder); eigene Folgeaufgabe.
  Neu ist hier nur die Grenze der PAT-Nummer und der Verletzungsnotiz.
- ein PAT-Ersatz als Formular; die Druckseite zeigt nur, was schon erfasst ist

## Decisions

### D1 Aufheben: Spalten an der Zeile, bedingtes UPDATE, 409

Verletzung und Maßnahme tragen `aufgehoben_at` und `aufgehoben_von_id`. Gesetzt wird mit
`UPDATE … WHERE id = ? AND aufgehoben_at IS NULL`. Ändert das keine Zeile, folgt 409, wie
`src/storno.rs` es macht (`src/AGENTS.md`, Statuscode-Konvention: Lebenszyklus 409).

- *Verworfen: eigene Aufhebungstabelle.* Sie wäre rein anhängend, hat aber kein Vorbild und bringt
  eine zweite Tabelle in alle drei Register.
- *Verworfen: 422 wie die Rücknahmen.* Die prüfen per SELECT und danach per UPDATE und sind nicht
  rennsicher.
- Einen Grund nimmt das Aufheben nicht an, also entsteht keine weitere Scrub-Spalte.

### D2 Transport: Verlaufstabelle mit Cache, eigener POST

`person_transport` ist anhängend. Jede Zeile ist ein voller Stand: `prioritaet`, `art`,
`fachrichtung`, je nullable. Eine Zeile mit drei NULL hebt auf. Der Cache an `einsatz_person`
umfasst `transport_prioritaet`, `transport_art`, `transport_fachrichtung` und `transport_at`. Der
Endpunkt ist `POST …/transport` mit Bestätigung und ETB in einem `write_retry!`.

- *Verworfen: drei Spalten per PATCH.* Der PATCH schreibt bewusst kein ETB, kennt kein
  „Bestätigt von“ und steht auch dem Betreuungsgerät offen. Außerdem ginge der Verlauf verloren,
  und medizinische Angaben sind anhängend (E-2, Annahme 7).
- *Verworfen: Cache-Spalten ohne Tabelle.* Damit gäbe es keinen Verlauf.

### D3 PAT-Nummer und Kontamination: Spalten per PATCH

`einsatz_person` bekommt `pat_nummer TEXT` und `kontamination INTEGER CHECK (kontamination IN
(0,1))`, beide nullable. NULL heißt „keine Angabe“, also nicht „nein“. Geschrieben wird über den
vorhandenen PATCH, einzeln dreiwertig. Die Bind-Kette in `repo::aktualisiere` wird neu
nummeriert, und der Test `aktualisiere_setzt_jede_spalte_an_ihren_platz` wächst mit.

- *Verworfen: UNIQUE je Einsatz.* Felddaten haben Tippfehler, und die App leitet nichts ab.
- *Verworfen: eigener POST mit Verlauf.* Die PAT-Nummer ist ein Kennzeichen, kein Verlauf.
- *Folge:* Das Betreuungsgerät hat PATCH auf Personen (`src/geraet/mod.rs:405`). Damit kann es
  auch diese Felder setzen, wie heute `zustand`. Wir lassen das so: Die Felder sind Stammdaten der
  Person, und eine Sonderregel je Feld widerspräche der Routenliste je Ansicht.

### D4 Klassifikation: Enum behalten, Freitext und Lage schwärzen

| Spalte | Regel |
|---|---|
| Region, Art, Ansicht, Schwere der Verletzung; Maßnahme; Transportpriorität und -art; Kontamination | Retain `G_TRIAGE` |
| `x`, `y`, `notiz` der Verletzung; Fachrichtung (Tabelle und Cache); `pat_nummer` | Scrub `Z_BEHANDLUNG`, gepinnt |
| `bestaetigt_name` | Scrub `Z_EINSATZ`, wie bei der Sichtung |
| `client_id`; Ankunftszeit | Retain `G_IDEMPOTENZ` bzw. `G_ZEIT` |

- Die Priorität **muss** Retain sein. Ihr ETB-Text kann sonst keine Ausnahme bekommen, weil die
  Liste für `person_*` und `einsatz_person.*` gesperrt ist.
- Die Fachrichtung wird geschwärzt, weil sie diagnosenah ist (Psychiatrie, Geburtshilfe).
- `behandlungsbezug_sql` wächst um `p.pat_nummer IS NOT NULL OR p.kontamination = 1`. Transport
  ist über seine Tabelle abgedeckt.
- `PERSONENBEZUEGE` bekommt je neue Tabelle einen Eintrag für Betroffene und einen für Personal
  (`bestaetigt_personal_id`).

### D5 Erfassungszeit und Idempotenz für alle medizinischen POSTs

Sechs POSTs nehmen `client_id` und `zeitpunkt_at` an: Sichtung, Verbleib, Notiz, Verletzung,
Maßnahme und Transport.

- **Schema**:
  - Neue Tabellen bekommen `zeitpunkt_at`, `erfasst_at` (Ankunft), `client_id` und den
    partiellen Unique-Index `(einsatz_id, client_id) WHERE client_id IS NOT NULL` (Muster 0098 und
    0122).
  - Die drei vorhandenen Tabellen behalten ihre Zeitspalte als Erfassungszeit
    (`gesichtet_at`, `zeitpunkt_at`, `erfasst_at`). Dazu kommen nullable `eingegangen_at` und
    `client_id`. SQLite lässt `ADD COLUMN … DEFAULT (strftime…)` nicht zu, deshalb setzt der
    INSERT den Wert.
- **Kappung** über `support::meldezeitpunkt`: mehr als 60 Sekunden in der Zukunft ergibt 400,
  sonst gilt min(t, jetzt). Neu kommt die Untergrenze `einsatz_person.erfasst_at` dazu, auf die
  gekappt wird. Eine nachgehende Gerätuhr verliert so keine dokumentierte Sichtung.
- **Replay** wie beim Anlegen (`einsatz_person.rs:243-256`): Die Warteschlangen-Berechtigung
  kommt vor der Suche nach `client_id`, und erst danach folgt `fordere_aktiv`.
- Bei einem Verbleib kommt der Auto-Austritt aus der UHS mit in denselben `write_retry!`.
- *Verworfen: eine neue `zeitpunkt_at` überall.* Lesepfade und Sortierung blieben dann nicht
  gleich.
- *Verworfen: Untergrenze abweisen.* Eine dokumentierte Sichtung ginge verloren.
- Damit wird auch der Nebenfund behoben: `sichten` sendet künftig das ETB-Live-Ereignis.

### D6 Jüngster Stand gewinnt

Nach jedem INSERT ermittelt dieselbe Transaktion den Cache neu, mit `ORDER BY <zeit> DESC, id DESC
LIMIT 1` (Muster `juengste_meldung!`). Folgen, die am aktuellen Stand hängen, laufen nur, wenn der
neue Eintrag gewinnt:
- der Auto-Austritt beim Verbleib;
- der Hinweis „Sichtung I“ (`wird_sk1`);
- die ETB-Zeile zur Transportpriorität.

Ein nachgereichter Eintrag schreibt seinen ETB-Text mit `ereigniszeit` und dem Zusatz
„nachgetragen“, wie `nachtrag_gegen`. Die Kurzform des Verbleibs wird aus der gewinnenden Zeile
neu berechnet.

### D7 Bestätigung zur Erfassungszeit

`bestaetigung::aufloesen` prüft gegen `zeitpunkt_at`: War die Kraft zu diesem Zeitpunkt im Einsatz
eingesetzt? Eine danach entlassene Kraft führt damit nicht zur Ablehnung einer vorgemerkten
Sichtung.

- *Verworfen: Prüfung gegen jetzt.* Dann fiele nach einem Schichtwechsel die ganze vorgemerkte
  Nachsichtung durch.

### D8 Offline im Frontend

- **Warteschlange**: Neue Aktionsarten kommen in die `OfflineSchreibaktion`-Union, in
  `useOfflineSync` (exhaustiv) und in `aktionsTitel`, jeweils über `mitErfassungszeitOfflineFaehig`.
- **Ansatzstellen**:
  - `saveSichtung` als einziger Sichtungsaufruf: Patientenkopf, Zeilen-Sichtung, Gerät
  - die Verbleib-Mutationen: Patientenkopf-Paneel, Grundriss-Transport, Desktop-Modal
  - die Notizzeile
  - die neuen Paneele für Verletzung, Maßnahme und Transport
- **Mutationen** laufen mit `networkMode: 'always'`. Die Quittung „Offline vorgemerkt“ steht am
  Ort.
- **Anzeige**: Vorgemerktes zeigt die Seite getrennt über `useVorgemerkteSchreibaktionen` (Regel
  „Was vorgemerkt ist, kennt der Server noch nicht“).
- **Grenze**: Ohne Netz geht nur, was im Speicher des Tabs geladen ist. Am Gerät liegt nichts auf
  der Platte.
- **Notiztexte**: Sie liegen in der Warteschlange auf dem Gerät, bis sie übertragen oder verworfen
  sind. So hält es schon das vorgemerkte Anlegen. `frontend/src/geraet/AGENTS.md` („Nichts auf der
  Platte“) nennt das ausdrücklich.
- **PATCH-Felder** (PAT-Nummer, Kontamination) bleiben online. Sie sind ohne Netz mit Grund
  gesperrt.

### D9 Lagebild ohne Netz

`PERSON_AUF_DER_PLATTE` (`offline/lagebildKuerzung.ts`) bekommt:
- `behalten`: Transportpriorität, Transportart, Kontamination
- `auslassen`: Fachrichtung, `transport_at`, PAT-Nummer

`lagebildKuerzen` kürzt künftig auch den Präfix `personenAuswahl`, weil die PAT-Nummer dort
hineinkommt. Ohne Netz findet die Palette die PAT-Nummer deshalb nicht. Das Detail liegt
weiterhin nicht auf der Platte, Verletzungen und Maßnahmen also auch nicht.

### D10 Sortierung nach Priorität

`dringlichkeit.ts` sortiert so:
1. Sichtungskategorie in der beschlossenen Folge
2. Transportpriorität: sofort, dringlich, normal, ohne
3. längste Wartezeit

`dringlichkeitsWert` bekommt dafür einen Zwischenschritt, damit am Gerät dieselbe Folge steht.

- *Verworfen: Priorität vor der Sichtungskategorie.* Das bricht die beschlossene Reihe.
- Die Betroffenenliste bekommt eine sortierbare Spalte „Transport“. Ihr `sortWert` ist der Rang,
  leere Werte stehen hinten, und sie hält das Fließspalten-Budget (LFH-523).
- Die Transportspalte im Grundriss zeigt nur Abtransportierte und trägt die Priorität als Marke,
  ohne neu zu sortieren.
- Darstellung der Priorität: ein neutraler Tag mit Wort. Die Sichtung bleibt die einzige
  Farbachse an der Person.

### D11 Kontamination als Status-Rolle `achtung`

Eine Kontamination „ja“ ist eine Gefahr für die Kräfte, nämlich Dekon und Eigenschutz. Sie bekommt
im Statusvertrag (`theme/statusFarben.ts`) einen Eintrag `kontamination` mit der Rolle `achtung`
und dem Wort „kontaminiert“. Er steht in Patientenkopf, Betroffenenliste und Patientenliste am
Gerät.

- *Verworfen: neutrales Wort ohne Rolle.* Es geht in einer vollen Zeile unter.
- *Verworfen: `alarm`.* Das kollidiert mit dem Rot von SK I.

### D12 Suche nach der PAT-Nummer

- **Liste**: Der Suchtext der Spalte `reg` hängt die PAT-Nummer an. Eine neue Spalte ist nicht
  nötig.
- **Palette**: `PersonAuswahl` bekommt `pat_nummer`. Eine reine Zifferneingabe prüft neben der
  Registriernummer auch die genau passende, normalisierte PAT-Nummer und rankt diesen Treffer wie
  einen Nummerntreffer. Das Label zeigt den Vorsatz „PAT“.
- *Verworfen: nur Fuse über das Label.* Das trifft zu unscharf.
- *Verworfen: Server-Suche.* Die gäbe es nur online, und die Palette sucht heute im Client.

### D13 Körperschema

- **Geometrie**:
  - Es gibt eine Regionsgeometrie in einem normierten Rahmen (0..1 je Ansicht), dazu drei Umrisse:
    männlich, weiblich, neutral.
  - Vorbild ist `marke/bildmarkeGeometrie.ts` mit seinem Guard.
  - Ein Test prüft, dass jede Region ihren Mittelpunkt innerhalb jedes Umrisses hat. Damit
    verschiebt ein Wechsel der Figur keine Markierung.
- **Kleine Regionen**: Die Trefferzonen von Hand, Fuß und Hals reichen über die Silhouette hinaus,
  nach außen bzw. unten, und erreichen in der Handschuh-Stufe 72 × 72 px. Die Tastatur durchläuft
  die Regionen in fester Folge (Roving Tabindex, Pfeiltasten).
  - *Verworfen: Zoom auf die Körperhälfte.* Das kostet drei Tipps, erlaubt sind zwei.
  - *Verworfen: eine Figur, die mit der Dichte wächst.* Sie wäre über 1000 px hoch.
- **Ablauf**: Ein Tipp auf die Region öffnet die Wahl der Art als Flächen, wie `SichtungsWahl`.
  Der zweite Tipp speichert. Die Schwere ist vorher optional wählbar, als Leiste vor der Art. Nachträglich
  geht nicht, weil eine Verletzung nur angehängt und aufgehoben wird (Abweichung aus der Umsetzung).
- **Sternchen**:
  - Teil der Zeichnung, in Textfarbe, mit Nummer. Fokus und Bedienung sind blau.
  - Sie sind kein Icon des Satzes (Spec `iconsatz`).
  - Die Nummer folgt fest der Erfassungsfolge über alle Markierungen, auch die aufgehobenen. Es
    entstehen Lücken.
- **Einbau**:
  - Im Patientenkopf steht das Datenfeld „Verletzungen“ mit Liste und ab `md` einer Mini-Figur.
  - „Verletzung markieren“ öffnet ein Paneel mit dem vollen Schema, nach dem Paneel-Muster von
    Sichtung und Verbleib.
  - Die Schnellansicht zeigt das Schema nur lesend.
- **Druck**:
  - Eigene Seite `/einsaetze/:id/personen/:pid/druck` nach dem Muster des Auftragsdrucks
    (LLH-1171).
  - Sie lädt einmal und hat „Neu laden“.
  - Das Audit läuft mit Art `druck` und `person_id`, was die CHECK-Liste in 0141 schon erlaubt.
  - Nicht am Gerät.
- **Prüfung**: Rollen und Namen im e2e, Kontrast von Silhouette und Sternchen im `theme/`-Test
  sowie im Browser (`betroffene-kontrast.spec.ts`).
  - *Verworfen: axe als neue Prüfabhängigkeit.* Sie bräuchte eine eigene Freigabe.

### D14 Patientenkopf mit vollem PAT-Kern

- **Kopfzeile**: Registriernummer, Status, Name; dazu „PAT A-4711“ und die Marke „kontaminiert“.
- **Datenraster** in zwei Spalten ab `lg`:
  - links Sichtung, Zustand / Verdacht, Aufenthalt / Verbleib, Transport;
  - rechts Maßnahmen (höchstens drei, dann „+ n weitere“), Verletzungen (Liste mit höchstens
    drei Einträgen und Mini-Figur), letzte Notiz.
- **Paneele**: Sichtung, Verbleib, Transport, Maßnahme, Verletzung. Immer nur eines ist offen. Der
  Wechsel ist gesperrt, solange gespeichert wird.
- **Messung**: Das e2e misst 1280 × 800 mit dem vollen Stand.

## Risks / Trade-offs

- [Eine große Change mit sechs Aufgaben] → `tasks.md` gliedert nach Aufgabe in fester Folge:
  1. Grundlage Erfassungszeit (1138, Backend)
  2. Spalten (1326)
  3. Transport (1325)
  4. Maßnahmen (1324)
  5. Verletzungen (1113)
  6. Körperschema (1120)
  7. Offline-Frontend (1138)

  Migrationen, Codegen und die Bind-Kette entstehen so nacheinander und nicht parallel.
- [Mehrere Migrationen im selben Branch] → fortlaufende Nummern ab 0217. `check-migrationen.sh`
  läuft vor jedem Push; den Autofix übernimmt der Bot bei einem Konflikt mit `alpha`.
- [Der Patientenkopf läuft bei 1280 × 800 über] → Kürzung mit „+ n weitere“ und Messung im e2e mit
  dem vollen Stand. Reicht das nicht, gehen Maßnahmen und Verletzungen in eine eigene Zeile unter
  dem Kopf. Das wäre dann eine Abweichung, die vorgelegt wird.
- [Ein Replay prüft die Bestätigung gegen eine historische Einsatzzeit] → Die Einsatzzeit einer
  Kraft liegt in der Kräfte-Zeitachse. Ist sie nicht auflösbar, gilt „aktiv jetzt“ als Rückfall,
  und das steht im Test.
- [Notiztext in der Warteschlange auf dem Gerät] → bewusst. So ist es beim Anlegen schon. Die
  Räumung beim Ende der Kopplung bleibt (Spec `geraetedaten-raeumung`).
- [Die Fachrichtung wird geschwärzt, die Auswertung über Einsätze verliert sie] → Die Auswertung
  ist nicht Ziel des PAT-Kerns. Priorität und Art bleiben erhalten.

## Migration Plan

1. `0217_person_verlauf_erfassungszeit.sql`: `client_id` und `eingegangen_at` an
   `person_sichtung`, `person_verbleib`, `person_verlaufsnotiz`, mit Unique-Indizes.
2. `0218_person_pat_kontamination.sql`: `pat_nummer` und `kontamination` an `einsatz_person`.
3. `0219_person_transport.sql`: Tabelle und Cache-Spalten.
4. `0220_person_massnahme.sql`
5. `0221_person_verletzung.sql`

Alle Migrationen fügen nur hinzu, nullable, ohne Datenwanderung. Ein Rollback heißt Revert des
Branches vor dem Release, weil Migrationen nie geändert werden.

## Nach der Umsetzung angepasst

- Schwere: vor der Art statt nachträglich am Listeneintrag (D13, Spec `koerperschema`). Ein
  nachträgliches Setzen bräuchte einen Änderungsweg an einer nur anhängenden Tabelle.
- Ohne Netz: Markieren, Maßnahme und Transport werden vorgemerkt. Aufheben bleibt ohne Netz
  gesperrt, weil die Aufheben-Routen weder `client_id` noch Erfassungszeit tragen (D1, D8).
- Die Figur wächst mit der Dichte, in der Handschuh-Stufe 480 × 704 px je Ansicht. Nur so erreichen
  Hand, Fuß und Hals 72 px (D13 verwirft erst die Variante über 1000 px).
