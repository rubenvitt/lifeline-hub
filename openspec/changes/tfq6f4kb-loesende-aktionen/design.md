# Design

## Context

Siehe proposal.md, „Why“. Der Scope vom 15.11.2026 hat ergeben:

- **Fahrzeug entlassen:** `entlassen_tx` (`src/fahrzeug/disposition_repo.rs`) löst in einer
  Transaktion Einheit, Besatzung, Führungsstelle, Beladung und Raum. Den Vorzustand gibt es nur
  an Live-Meldungen und ETB-Text weiter. „Rückgängig“ ruft `…/reaktivieren`, den Weg von „Erneut
  disponieren“. Das setzt den Anfangsstatus (daher S3 statt S2) und stellt keine Bindung her.
  Personal (`src/personal/disposition_repo.rs`) und Material haben dieselbe Lücke.
- **Aus Einheit lösen:** In `pages/einheit/FahrzeugeBesatzung.tsx` steht für Fahrzeuge ein roter
  Zeilenknopf ohne Rückweg. Der Server setzt nur `einheit_id = NULL`, die Besatzung behält ihre
  Bindung. Der vorhandene `PUT …/einheiten/{eid}/fahrzeug/{ef}` stellt den Normalfall wieder her,
  nimmt das Fahrzeug aber auch einer anderen Einheit still weg. Personen lösen über das ⋮. Wer
  dabei Einheitsführer war, verliert die Rolle (`mitglied_repo.rs`).
- **Vorbild:** `kraefte/MaterialAmOrt.tsx` hält die gelöste Zeile als träge Marke „Gelöst“
  (`useHoldGeloest`, lokal). Rückgängig gibt es dort nur im Toast
  `kommunikation/rueckgaengig.tsx` (6 s, fester Schlüssel).
- **Farbe:**
  - `frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“ (LFH-363), regelt sichtbare
    Knöpfe: Umkehrbares bekommt `danger` und Abstand, aber keine Rückfrage.
  - Im Menü steht laut `MenueAusloeser` (`gefahr` = unumkehrbar) und Fahrzeugliste das
    umkehrbare „Entlassen“ neutral.
  - Die Spec `datensatz-aktionsmenue` verlangt dagegen „unumkehrbar oder entfernend → rot“.
  - Im Einheit-Personenmenü stehen die Lösen-Einträge rot.
- **Beenden im Bestand:** rund 30 Stellen mit vier Sicherungsstufen (keine, Rückgängig,
  Rückfrage, Rückfrage mit Grund). Inventar mit Datei:Zeile im Scope-Bericht. Die Folgen hier
  stehen in tasks.md.

## Goals / Non-Goals

**Goals:**
- Jede lösende Aktion gehört zu einer der fünf Arten aus D1 und folgt deren Verb, Ort und
  Sicherung.
- Ein „Rückgängig“ beim Fahrzeug stellt den Zustand vor dem Entlassen her. Im Einheit-Detail
  scheitert es sichtbar, statt still zu überschreiben.
- Ein Doppeltipp löst nie zwei Datensätze.

**Non-Goals:**
- Bearbeiten (UHS und BR in die Ansicht) und Anlegen (Drawer, eingeklappte Formulare) im
  Bestand nachziehen. Die Regel steht, den Umbau bringen Folgeaufgaben.
- Vollständige Rücknahme beim Entlassen von Personal und Material (Folgeaufgaben, Lücke
  benannt).
- Rückgängig nach Neuladen oder von einem anderen Gerät.
- Vorbedingung beim Rückgängig von Material am Ort (gleiche Lücke wie beim Fahrzeug im
  Einheit-Detail, Folgeaufgabe).

## Decisions

### D1 Fünf Arten des Beendens

| Art | Verb | Ort | Sicherung |
|---|---|---|---|
| Zuordnung lösen | „Aus <Ziel> lösen“ / „Vom <Ziel> lösen“; „Abziehen“, „Austragen“ bleiben | ⋮ der Zeile; sichtbarer Knopf nur als einzige Handlung der Zeile | ohne Rückfrage, Rückgängig; fällt der Datensatz aus der Ansicht, hält die Zeile „Gelöst · Rückgängig“ |
| Kraft entlassen | „Entlassen“, Material „Aus dem Einsatz nehmen“ | Liste: ⋮; Detail: letzter Abschnitt „Aus dem Einsatz“; nie Hauptaktion einer Karte | Rückgängig nur bei vollständigem Rückweg, sonst Rückfrage (Ausnahme bis zu den Folgeaufgaben: Personal, Material) |
| Gebilde beenden | „Auflösen“ (endgültig), „Schließen“ (umkehrbar) | Auflösen: letzter Abschnitt der Detailseite, ohne Detailseite rot im ⋮; Schließen: Statusschritt im Kopf | Auflösen: Rückfrage mit Folgesatz; Schließen: Rückgängig |
| Fehlanlage | „Stornieren“ | immer ⋮, rot hinter dem Trenner (Detailseite: ⋮ des Kopfs) | Rückfrage im Dialog |
| Eigene Buchung | „Zurücknehmen“ („Zurückziehen“, „Aufheben“ bleiben Fachwörter) | Zeile oder ⋮ | Rückfrage; Grund nur, wo das Fach ihn verlangt |

**Warum nach Art statt nach Modul:** Die Sicherung folgt aus der Umkehrbarkeit, der Ort aus der
Häufigkeit. Eine Tabelle nach Modulen würde den Wildwuchs nur abschreiben.

**Verworfen:**
- „Abziehen“ und „Austragen“ in „… lösen“ umbenennen: Beides sind eingeführte Fachwörter.
- Ein Rückfrage-Baustein für alle: Rückfragen aus dem Menü gehen schon über `<Modal>` bzw.
  `kartenKontext.rueckfrage`, ein zusätzlicher Baustein wäre ein dritter Weg.

### D2 Farbe: im Menü ist nur Endgültiges rot

Ein Menüeintrag mit Rückgängig steht neutral, rot hinter dem Trenner steht nur Unumkehrbares.
Das bestätigt `MenueAusloeser` und die Fahrzeugliste und schärft die Spec
`datensatz-aktionsmenue` nach. Sichtbare Knöpfe behalten LFH-363 (`danger` und Abstand, keine
Rückfrage). Ein roter Knopf in der Zeile trennt dort optisch, im Menü übernimmt das der Trenner.

**Berichtigung zur Abstimmung am 15.11.2026:** Die Frage nannte LFH-363 als „umkehrbar heißt
neutral“. Das stimmt nur für das Menü, für Knöpfe verlangt LFH-363 Rot. Die Entscheidung
„neutral, rot nur endgültig“ gilt deshalb für das Menü, die Knopfregel bleibt. So steht es in
der Vorlage zur Freigabe.

**Verworfen:** auch umkehrbares Lösen im Menü rot. Dann stünde „Entlassen“ mit Rückgängig
gleichrangig neben „Stornieren“ ohne Rückweg, und die Farbe trüge keine Information mehr.

### D3 Kopf: höchstens zwei Handlungen

Sichtbar sind die Primäraktion und eine zweite Handlung. Ein Statusschritt hat dabei Vorrang vor
„Bearbeiten“. Alles Weitere steht im ⋮ des Kopfs (`EinsatzSeite` `weitere` bzw. ein
`MenueAusloeser`). Das behebt den Umbruch „unter dem Titel“ bei Evakuierung und UHS: Der Kopf hat
dort keinen eigenen Platz, sondern bricht über `flexWrap` um, weil zu viele Knöpfe darin stehen.
Beim Evakuierungsbezirk wandert „Bearbeiten“ ins ⋮, bei der UHS fällt „Auflösen“ aus dem Kopf
(D4).

**Verworfen:** eine feste Breite oder ein Umbruchverbot am Seitenkopf. Das verdeckt das
Symptom, und bei 1024 px liefe der Kopf über.

### D4 Auflösen als letzter Abschnitt

UHS und Bereitstellungsraum übernehmen das Muster der Einheit („Einheit auflösen“, Spec
`einheit-ansicht`) und des Einsatzabschlusses (LFH-960): ein letzter Abschnitt mit rotem Knopf,
der Folge in einem Satz und einer Rückfrage mit benanntem Bestätigungsknopf. Die Sperre „noch n
Personen“ bleibt am Knopf. Gebilde ohne Detailseite behalten das rote ⋮ mit Dialog: die
Verpflegungsstelle (Karte), der Einsatzabschnitt (Paneel). Bei der Verpflegungsstelle entfällt
die Ellipse an „Auflösen …“ und „Stornieren …“, weil kein anderes Menü sie führt.

**Verworfen:** Auflösen als zweiter roter Kopfknopf. Das bricht D3, und Endgültiges stünde neben
der Primäraktion.

### D5 Fahrzeug: Rücknahme über einen eigenen Schreibweg, Vorzustand beim Client

Mit dem Menschen abgestimmt:

- `POST …/fahrzeuge/{ef}/entlassen` antwortet mit `{ fahrzeug, vorzustand }`. Der `vorzustand`
  enthält:
  - `entlassen_at`, das als Kennung dieses Entlassens dient;
  - `zuletzt_entlassen_at` von vorher (Storno-Sperre);
  - `einheit_id`, `br_id`, `fuehrungsstelle` (ja/nein, denn die Führungsstelle ist je Einsatz
    eine Menge von Fahrzeugen);
  - `besatzung: [ep_id]`, `beladung: [em_id]`.
  - Status und „Status seit“ stehen nicht darin: Das Entlassen lässt sie an der Zeile stehen, erst
    `reaktivieren` überschrieb sie. Die Rücknahme fasst sie nicht an (beim Umsetzen festgestellt).
- `entlassen_tx` füllt ihn aus dem, was es ohnehin liest. Der Client hält ihn, solange der
  Hinweis offen ist.
- Neu: `POST …/fahrzeuge/{ef}/entlassen/zuruecknehmen` mit dem `vorzustand` als Body. Gate:
  `EinsatzSchreibzugriff<Fahrzeuge>` (ADR-0005). In einer Transaktion:
  1. **Riegel:** `beendet_von` = Aufrufer, die Art ist „entlassen“, `beendet_at` =
     `entlassen_at` (sonst wurde inzwischen reaktiviert oder neu entlassen), höchstens zehn
     Minuten her. Sonst 409.
  2. **Endzustand aufheben:** `beendet_*` = NULL, `zuletzt_entlassen_at` aus dem Body (muss vor
     `entlassen_at` liegen, sonst 422). Status und „Status seit“ bleiben, wie sie sind: keine
     Zeitachse, kein „wieder verfügbar“.
  3. **Bindungen** einzeln, nur was noch frei ist:
     - Einheit: aktiv, und die Person hat Recht im Modul Einheiten (`fordere_zielmodul`, wie
       `update`).
     - Besatzung: aktiv und ohne Fahrzeug.
     - Raum: aktiv; Eintritt-Ereignis mit Notiz „Entlassung zurückgenommen“, Recht wie beim
       Eintragen.
     - Führungsstelle: das Fahrzeug kommt wieder in ihre Menge (`INSERT OR IGNORE`); Schreibrecht
       im Einsatz genügt wie beim Ändern der Führungsstelle.
     - Beladung: im Einsatz und ohne Ort, Recht im Modul Material.
     - Was ausfällt, landet in `ausgelassen: [{ art, bezeichnung, grund }]`.
  4. **ETB** „Entlassung zurückgenommen“, bei Auslassungen mit „ohne …“. **Live** wie beim
     Entlassen.
- Antwort: `{ fahrzeug, ausgelassen }`. Der Client zeigt Ausgelassenes im `SeitenHinweis`
  („83-1 zurück, ohne: Müller (sitzt auf 83-2)“).
- „Erneut disponieren“ im Block „Entlassen“ bleibt bei `reaktivieren`.

**Warum der Riegel reicht, obwohl der Client den Vorzustand liefert:** Der Body nennt nur
Kennungen. Jede Bindung entsteht nur, wenn ihr Ziel frei ist und die Person das Recht des Moduls
hat. Ein gefälschter Body bindet also höchstens freie Datensätze, die die Person ohnehin binden
dürfte, und das nur am eigenen, eben entlassenen Fahrzeug.

**Verworfen:**
- Vorzustand serverseitig speichern: Das braucht Migration, Instanzspiegel und Schwärzung, und
  es wird Rückgängig nach Neuladen nicht gebraucht (Abstimmung).
- Kette vorhandener Schreibwege im Client: nicht atomar, viele ETB-Einträge, und der Status-PATCH
  schreibt Zeitachsen-Marken der Einheit.
- Rückfrage statt Rückgängig: widerspricht „ohne Rückfrage“ in `kraefte-entlassung`.

### D6 Einheit-Detail: Rücknahme mit Vorbedingung

- **Fahrzeug:** Rückgängig ruft den vorhandenen `PUT …/einheiten/{eid}/fahrzeug/{ef}` mit der
  neuen Vorbedingung `?nur_wenn_frei=true`. Steht das Fahrzeug inzwischen in einer anderen
  Einheit, antwortet der Server mit 409 und nennt die Einheit. Ohne den Parameter bleibt das
  heutige Verhalten (Umhängen beim bewussten Zuordnen).
- **Person:** Ebenso `PUT …/einheiten/{eid}/personal/{ep}?nur_wenn_frei=true`, erweitert um
  `als_fuehrer=true`. Damit kommen Mitgliedschaft und Führerrolle in einer Transaktion zurück.
  Ist der Führerplatz inzwischen besetzt, bleibt die Person Mitglied, und die Antwort nennt das.
  - Löst „Aus Einheit lösen“ auch das Fahrzeug der Person (prüfen in `mitglied_repo.rs`), kommt
    `fahrzeug_id=<ef>` dazu.
  - „Vom Fahrzeug lösen“ nimmt der vorhandene Besatzungs-PUT zurück.
- Der Grund einer Ablehnung steht im Seitenhinweis der Einheit, weil die Zeile dann schon
  wegfallen kann (Regel „Speicherfehler an die Seite“).

**Verworfen:** das Rückgängig ohne Vorbedingung. Es würde ein Fahrzeug still aus einer anderen
Einheit reißen, genau die Art Fehler, die diese Change behebt.

### D7 Geteilter Halte-Baustein

`useHoldGeloest` wandert aus `kraefte/MaterialAmOrt.tsx` nach `components/useHoldGeloest.ts`
(generisch über Kennung und Zeile, `HOLD_MS` mit). MaterialAmOrt und FahrzeugeBesatzung nutzen
ihn.

- **Die gehaltene Zeile** zeigt „Gelöst“ träge an der Stelle des Auslösers, der gelöst hat
  (Lösen-Knopf bzw. ⋮). „Rückgängig“ steht als eigener Knopf an der Stelle eines Reglers, der
  nichts löst (FMS-StatusWahl bzw. Material-Status). Ein zweiter Tipp an dieselbe Stelle trifft
  so immer die träge Marke.
- **Besatzung:** Die Personen eines gelösten Fahrzeugs bleiben gedämpft unter dem Platzhalter,
  bis er fällt. Sonst wandern sie sofort nach „Ohne Fahrzeug“, und die Höhe springt trotzdem.
- **Personen:** Personenzeilen werden nicht gehalten. „Vom Fahrzeug lösen“ verschiebt die Person
  nur innerhalb der Ansicht, „Aus Einheit lösen“ liegt im ⋮ (kein Doppeltipp-Risiko). Für beide
  genügt der Toast.

### D8 Regeln für Bearbeiten und Anlegen ohne Spec

Die Muster für Bearbeiten und Anlegen kommen in `frontend/AGENTS.md` und in die ADR.

- **Bearbeiten:** LLH-1139 bestätigt. „Bearbeiten“ eines Paneels steht im Paneelkopf, das der
  ganzen Ansicht nach D3 im Kopf oder ⋮.
- **Anlegen:** Regel ist das `ErfassungsModal`. Eine eigene Seite nur bei einem Ablauf oder mehr
  als ~5 Pflichtfeldern. Ein eingeklapptes Formular nur bei Serienerfassung neben einer Liste.
  Kein Drawer.

Die Altstellen stehen dort als Liste mit Folgeaufgabe. Spec-Anforderungen bringen erst die
Folgeaufgaben mit, sonst beschriebe eine Spec ein Verhalten, das der Code nicht hat.

### D9 Betreuungsstelle schließen

Ohne Belegung zeigt „Schließen“ einen Rückgängig-Hinweis, der über den vorhandenen
Statusübergang wieder `in_betrieb` setzt (serverseitiger Rückweg, LFH-343). Mit Belegung bleibt
die Leermeldung die Sicherung. Rückgängig gibt es dann nicht, weil die Meldung 0 nicht
mitzurücknehmen ist.

## Risks / Trade-offs

- **[Antwort von `…/entlassen` ändert ihre Form]** → Der einzige Nutzer ist das eigene
  Frontend. Vor dem Umbau mit `src/AGENTS.md` (öffentliche API v1) und `src/api_doc.rs` prüfen,
  dass die Route nicht zur v1 gehört. Typ-Codegen im selben Commit.
- **[Rückgängig gibt es nur, solange der Hinweis steht (6 s)]** → Das ist abgestimmt. Danach
  bleibt „Erneut disponieren“, der Riegel von zehn Minuten deckt Latenz und den Seitenhinweis ab.
- **[Teil-Rücknahme kann überraschen]** → `ausgelassen` nennt jeden fehlenden Teil in Worten, und
  das ETB auch.
- **[Rechte beim Rückgängig strenger als beim Entlassen]** → Wer nur Fahrzeuge schreiben darf,
  bekommt die Einheit nicht zurück, und der Hinweis sagt das. Bewusst: Die Rücknahme bindet neu,
  das Entlassen löst nur.
- **[Altstellen außerhalb der Änderung (Anlegen, Bearbeiten, Personal, Material)]** → Sie stehen
  benannt in `frontend/AGENTS.md` und als Zunder-Folgeaufgaben, damit die Regel nicht stillschweigend
  verletzt wird.
- **[Bilder und Doku-Kapitel veralten]** → Die Kapitel `fahrzeuge`, `einheiten`, `uhs`,
  `bereitstellungsraeume`, `betreuung`, `evakuierung` und ihre Bilder-Specs ziehen im selben
  Branch mit.

## Migration Plan

Keine Datenmigration. Die neue Route ist additiv. Die geänderte Antwort von `…/entlassen` und
der neue Query-Parameter gehen mit dem Frontend in einem Release aus, weil das Backend das
Frontend einbettet. Rückweg: den Commit zurücknehmen, es bleibt kein Zustand in der DB.
