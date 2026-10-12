# Design

## Context

Anlass und Entscheidungen: `proposal.md`. Anforderungen: die Deltas unter `specs/`. Stand im Code am
12.10.2026:

- **Einsatzleiter** (LFH-1199): vier Spalten an `einsatz_fuehrungsstelle` (`einsatzleiter_art`,
  `…_personal_id`, `…_name`, `…_seit`). `src/einsatz/fuehrungsstelle.rs::load_tx` liest sie mit
  einem LEFT JOIN auf `einsatz_personal` für `personal_noch_disponiert` und formt daraus
  `EinsatzleiterAnzeige`. Ohne Art oder `seit` gibt es keinen Einsatzleiter.
- **Darstellung** nur in `frontend/src/stab/einsatzleiter.ts`: `einsatzleiterDarstellung(quelle)`
  nimmt die ganze `FuehrungsstelleQuelle` (Zustand und Daten), `einsatzleiterKurz` gibt Name und
  Vermerk ohne Zeit, `einsatzleiterName` setzt „Name geschwärzt“ und „(extern)“.
- **Kommunikationsplan:** `stab/kommunikationsplan.ts::fuehrungsstelleZeile` setzt den Nebentext
  auf den Rufnamen bzw. bei fehlender Quelle auf `ZUSTAND_GRUND`. Die Seite zeigt den Nebentext am
  Schirm und im Druck (`pages/KommunikationsplanPage.tsx`).
- **Einsatzliste:** `GET /api/einsaetze` (`src/einsatz/repo.rs::liste_fuer`) liefert
  `EinsatzAnzeige`, gefiltert über `darf_lesen`. Dasselbe DTO baut `Einsatz::anzeige` für das Detail
  (`repo::laden`) und für den Lage-Snapshot (`src/lage_snapshot/repo.rs::erzeuge`). Die Kachel
  rendert `pages/EinsaetzePage.tsx::renderKarte`.
- **Live:** Ein PATCH der Führungsstelle ruft `kopf_geaendert` → `live::org::kopf_melden`. Das
  verteilt `einsatz` und `einsatzliste` an die Leser. Ein Wechsel des Einsatzleiters erreicht die
  Einsatzliste also schon heute.
- **Offline:** `einsatz` (Kopf) und `einsaetze` (Liste) stehen in `LAGEBILD_OFFLINE`, die
  Führungsstelle nicht. `teilschwaerzungen` an Kopf und Liste räumt das Gerät nach einer
  Schwärzung (LFH-996). Eine Personen-Schwärzung des Einsatzleiters zählt dort mit
  (`schwaerzung_person.rs`, Bezug `einsatzleiter_personal_id`).

## Goals / Non-Goals

**Goals:**
- Eine Umformung der vier Spalten im Backend und eine Darstellung im Frontend. Die beiden neuen
  Stellen bekommen keine eigene Regel.
- Ehrliche Optionalität am Wire: dasselbe Feld trägt in Liste und Detail dieselbe Aussage.

**Non-Goals:**
- Kein Umbau der Kopfleiste, des Funkplans oder des Organigramms auf das neue Feld. Sie lesen
  weiter `GET …/fuehrungsstelle`.
- Kein Einsatzleiter in der Fernmeldeskizze (keine Personennamen), in der Vorbereitung der
  Lagebesprechung und in der Akte der Aufbewahrung. Das bleibt wie in LFH-1199.
- Kein Einsatzleiter im Lage-Snapshot.
- Kein neues Live-Ereignis, keine Migration.

## Decisions

### D1 · Das Feld hängt an `EinsatzAnzeige`, gefüllt in Liste und Detail

`EinsatzAnzeige` bekommt `einsatzleiter: Option<EinsatzleiterAnzeige>` mit
`skip_serializing_if = "Option::is_none"` (Norm LFH-265). `Einsatz` trägt die Rohspalten, `laden`
und `liste_fuer` holen sie mit demselben LEFT JOIN wie `load_tx`:

```sql
LEFT JOIN einsatz_fuehrungsstelle fs ON fs.einsatz_id = e.id
LEFT JOIN einsatz_personal ep ON ep.id = fs.einsatzleiter_personal_id
```

Die Umformung aus Art, Personal-ID, Name, `seit` und `personal_noch_disponiert` steht einmal in
`fuehrungsstelle.rs` (etwa `einsatzleiter_aus_spalten`). `load_tx`, `Einsatz::anzeige` und
`liste_fuer` rufen sie. Die Liste bleibt bei O(1) Abfragen, denn der JOIN ist 1:1 (eine Zeile
Führungsstelle je Einsatz, Primärschlüssel `einsatz_id`).

Verworfen:
- **Nur die Liste füllt das Feld, das Detail lässt es weg.** Dann hieße „fehlt“ im Detail
  „unbekannt“, in der Liste „nicht erfasst“. Das ist die Wire-Lüge, vor der der Kommentar an
  `meine_sachgebiete` warnt.
- **Eigenes DTO für die Liste** (`EinsatzListenEintrag`). Das ändert den Typ von
  `GET /api/einsaetze` und jeden Abnehmer der Liste (Switcher, Palette, Offline-Vorrat) für ein
  Feld.
- **Je Kachel ein `GET …/fuehrungsstelle`.** N Abrufe auf der Startseite, und die Liste läge
  ohne Netz ohne Einsatzleiter da.

### D2 · Der Lage-Snapshot friert keinen Einsatzleiter ein

`lage_snapshot::erzeuge` setzt `einsatzleiter` auf `None`, bevor er `EinsatzAnzeige` als JSON
speichert. Der Snapshot hält das Lagebild der Karte fest, keine Führungsangaben. Ein eingefrorener
Name bräuchte zudem einen JSON-Pfad in der Schwärzungsregistrierung (`lage_snapshot.daten$…`).

Verworfen: Den Namen mit einfrieren und die Registrierung um den Pfad ergänzen. Kein Abnehmer des
Snapshots zeigt den Einsatzleiter.

### D3 · Gesperrter Einsatz: der Frist-PUT nimmt den Einsatzleiter heraus

`ohne_kopf_pii_wenn_gesperrt` (`src/routes/einsatz.rs`) entfernt schon Einsatzort, meldende Stelle
und Sachverhalt, wenn die Antwort einen für die Person gesperrten Einsatz zeigt. Der Name des
Einsatzleiters ist PII derselben Art und fällt dort ebenso weg. Die Liste braucht das nicht, denn
sie filtert über `darf_lesen`.

### D4 · Offline liegt der Name mit Liste und Kopf auf dem Gerät

Die Liste und der Kopf sind offline lesbar, also liegt der Name dort mit. LFH-1199 hatte nur den Key
der Führungsstelle draußen gelassen, aus Sparsamkeit, nicht wegen einer Regel. Namen des
Einsatzpersonals liegen schon heute über `EINSATZ_KEYS.personal` auf der Platte. Eine Schwärzung
räumt das Gerät über `teilschwaerzungen` (LFH-996), auch nach einer Personen-Schwärzung des
Einsatzleiters. Es gibt also keine neue Sonderlage nach `frontend/src/offline/AGENTS.md`.

Verworfen: das Feld beim Schreiben auf die Platte kürzen (`offline/lagebildKuerzung.ts`). Dann
zeigte die Kachel ohne Netz „EL nicht erfasst“, und das wäre falsch.

### D5 · Frontend: Darstellung aus der Angabe statt aus der Quelle

`stab/einsatzleiter.ts` bekommt `einsatzleiterAusAngabe(e: Einsatzleiter | null | undefined):
EinsatzleiterDarstellung` (`erfasst` oder `nicht-erfasst`). `einsatzleiterDarstellung(quelle)`
ruft sie für den Zustand `daten`. Beide neuen Stellen formen den Text über `einsatzleiterKurz`:

- **Kommunikationsplan:** Nebentext = `[rufname, "Einsatzleiter " + einsatzleiterKurz(d)]`, mit
  „ · “ verbunden, leere Teile entfallen. Bei fehlender Quelle bleibt `ZUSTAND_GRUND`, denn ein
  „nicht erfasst“ dort wäre falsch.
- **Kachel:** eine Zeile `<abbr title="Einsatzleiter">EL</abbr> {einsatzleiterKurz(d)}`, gedämpft
  wie der Ort (`rollen.text2`), Name mit `overflowWrap: 'anywhere'`. `data-lfh="einsatzleiter"`
  für Tests. Ohne Angabe „EL nicht erfasst“.

„seit“ steht in keiner der beiden Stellen. Die Kachel nennt den Beginn des Einsatzes schon, und im
Kommunikationsplan zählt, wer die Stelle leitet, nicht seit wann. Das ist dieselbe Wahl wie im
Funkplan (`einsatzleiterKurz`).

Verworfen: „Einsatzleiter“ ausgeschrieben in der Kachel. Die Kachel ist schmal (`kachelMinKlein`),
„EL“ ist das Kürzel nach FwDV 100, und `abbr` trägt den vollen Namen.

## Risks / Trade-offs

- [Ein Entlassen der Person ändert „nicht mehr disponiert“ ohne Ereignis `einsatzliste`] → Die
  Kachel zieht beim nächsten Abgleich der Liste nach, wie heute die Kopfleiste beim Abgleich der
  Führungsstelle. Kein eigenes Ereignis dafür.
- [Neues Feld an einem viel genutzten DTO] → Optional mit `skip_serializing_if`. Bestehende
  Fixtures im Frontend bleiben gültig, Typ-Codegen wird geprüft (`scripts/check-typ-codegen.sh`).
- [JOIN in `laden`, das sehr oft läuft] → 1:1 über Primärschlüssel, kein Mehraufwand von Belang.

## Migration Plan

Keine Migration. Alte Clients ignorieren das neue Feld. Rückbau: Feld und JOINs entfernen.
