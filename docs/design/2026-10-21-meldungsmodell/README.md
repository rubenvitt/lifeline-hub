# Ein Meldungsmodell: Meldung, Lagemeldung, ETB-Eintrag „Lage“ (21.10.2026)

Zielbild aus LLH-1027. Ruben, UX-Durchgang 10.10.2026: „Noch keine Lagemeldung“ ist sichtbar,
dann muss man eine Meldung anlegen, und die ist dann irgendwie eine Lagemeldung. Wird im ETB eine
Lagemeldung angelegt, erscheint sie nicht unter Lagemeldungen. „Das ganze Thema ist sehr schwer zu
verstehen.“

Befund: kein Fehler, ein Modellbruch. Heute heißen drei unverbundene Dinge „Lagemeldung“: eine
Meldung der Art „Lagemeldung“ (Tabelle `meldung`), ein Lageobjekt (Tabelle `lage_meldung`, nur über
„An Lage übergeben“) und ein ETB-Eintrag vom Typ „Lage“. Keine der drei Ablagen kennt die anderen.

**Stand dieses Ordners:** Text und Skizzen, **noch kein Claude-Design-Entwurf** (Prompt unten).
Die Regeln stehen als Zielbild in `frontend/src/etb/AGENTS.md`, `frontend/src/geraet/AGENTS.md`
und `src/AGENTS.md`, jeweils Abschnitt „Meldungsmodell (LLH-1027)“. Sie gelten ab dem jeweiligen
Folgeticket; bis dahin gilt das Bestehende.

## Entscheidungen

1. **Eine Quelle:** Jede Lagemeldung ist eine Meldung. „Lagemeldung“ ist eine Meldungsart,
   „lagerelevant“ ein Merkmal der Meldung. Die Seite „Lagemeldungen“ ist eine Sicht auf alle
   lagerelevanten Meldungen und erfasst dort selbst („Lagemeldung erfassen“). Verworfen: drei
   Ablagen beim Lesen vereinigen (drei Statusmodelle, ETB ohne Triage), nur umbenennen (die
   ETB-Lagemeldung erschiene weiter nirgends).
2. **ETB-Typ „Meldung“ und „Lage“ gehen in den Meldungseingang**, vorgabemäßig. Für reine
   Mitschriften gibt es den Schalter „Nur protokollieren“; er springt nach jedem Erfassen zurück.
3. **Art „Lagemeldung“ ist immer lagerelevant**, auf jedem Weg und in jede Richtung. Andere Arten
   werden in die Lage übernommen.
4. **Der Modulname „Lagemeldungen“ bleibt.** „Meldungen (eingehend)“ heißt künftig „Meldungen“.
5. **`lage_meldung` wird aufgelöst:** die Lage-Angaben werden Spalten der Meldung, in einer
   Migration, ohne Altbestand.

Umsetzung: LLH-1039 (Ereigniszeit, noch auf `lage_meldung`) → LLH-1031 (Quelle, Migration,
Erfassen auf der Seite, Gerät) → LLH-1037 (ETB → Meldungseingang) und LLH-1066 (Korrektur).
Daneben LLH-1046 (Wortlaut) und LLH-1062 (Hinweis bei jeder neuen Lagemeldung).

## Begriffe

| Begriff            | Bedeutung                                                                                                                                                                                         | Im System                                                                                                    | Nicht                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Meldung**        | Jede Nachricht über den Meldeweg (Funk, Telefon, persönlich, sonstige), nach dem Nachrichtenvordruck: Absender, Empfänger, Wortlaut, Ereigniszeit. Wird gesichtet, bearbeitet, erledigt (Triage). | Tabelle `meldung`, Modul „Meldungen“ (heute „Meldungen (eingehend)“)                                         | kein ETB-Eintrag; das ETB protokolliert sie                            |
| **Lagemeldung**    | Meldungsart: der Inhalt ist die Lage (FwDV 100, Lagefeststellung). Auch nach außen an die übergeordnete Stelle.                                                                                   | `meldung.meldungsart = 'lagemeldung'`; immer lagerelevant                                                    | keine eigene Objektart, kein eigener Bestand                           |
| **lagerelevant**   | Merkmal einer Meldung: S2 führt sie im Lagebild. Art „Lagemeldung“ hat es ab Anlage, andere Arten bekommen es durch „In die Lage übernehmen“, wahlweise mit eigenem Lage-Text und Ort.            | `meldung.lagerelevant`, `lage_text`, `lat`/`lon`, `lage_uebergeben_*`; Seite und Kartenebene „Lagemeldungen“ | keine Kopie der Meldung                                                |
| **gesehen**        | Kenntnisnahme durch die Lage (LLH-1206): eine lagerelevante Meldung ist „neu“, bis jemand mit Schreibrecht an den Lagemeldungen sie als gesehen kennzeichnet. Für alle gleich.                    | `meldung.lage_gesehen_*`, Modulzähler „n neue Lagemeldungen“                                                 | nicht „gesichtet“ (das ist die Triage im Meldungseingang)              |
| **ETB-Typ „Lage“** | Protokolleintrag über die Lage. Entsteht beim Erfassen im ETB oder als automatischer Eintrag einer Lagemeldung. Mehrzahl „Lagefeststellungen“ (LLH-1065).                                         | `etb_eintrag.typ = 'lage'`                                                                                   | keine Lagemeldung; mit „Nur protokollieren“ legt er keine Meldung an   |
| **Lagebericht**    | Gegliedertes Dokument über die Lage (Abschnitte, Freigabe, Verteiler), etwa für die Lagebesprechung oder die übergeordnete Stelle.                                                                | Modul „Lageberichte“; aus dem ETB über „Als strukturierten Lagebericht erfassen →“                           | keine Meldung, steht nicht in den Lagemeldungen                        |
| **Meldungsstrom**  | Heute das Paneel des Lagebilds mit den jüngsten ETB-Einträgen aller Typen.                                                                                                                        | `pages/lage-dashboard/meldungsstrom.ts`                                                                      | zeigt keine Meldungen; heißt künftig „Jüngste ETB-Einträge“ (LLH-1046) |

Ein Satz für die Anwenderdoku: **„Jede Lagemeldung ist eine Meldung; die Seite Lagemeldungen zeigt
alle lagerelevanten Meldungen.“**

## Datenfluss: Woher kommt eine Lagemeldung?

```
 Meldungsformular ──┐  Art „Lagemeldung“ (auch „Lagemeldung erfassen“ auf der Seite Lagemeldungen)
 Gekoppeltes Gerät ─┤  Segmentleiste „Meldung · Lagemeldung“ in GeraetMeldungen
 ETB-Erfassung ─────┤  Typ „Lage“ ohne „Nur protokollieren“ → Art „Lagemeldung“
                    │  Typ „Meldung“ ohne „Nur protokollieren“ → Art „Sonstige“ (nur Eingang)
                    ▼
            ┌───────────────┐   lagerelevant = 1 ab Anlage, wenn Art „Lagemeldung“
            │    meldung    │◀── „In die Lage übernehmen“ für andere Arten (Lage-Text, Ort)
            └───────┬───────┘
     ┌──────────────┼──────────────────┬─────────────────────────┐
     ▼              ▼                  ▼                         ▼
 Meldungseingang  Seite „Lagemeldungen“  Lagekarte-Ebene        ETB
 (Triage: neu →   (lagerelevante, Marke  „Lagemeldungen“         ein Eintrag je Meldung:
  gesichtet → …)  „Neu“ bis gesehen)     (verortete)             Typ „Lage“ für Lagemeldungen,
                                                                 „Meldung“ für andere Arten
```

| Weg                               | Entsteht                                   | ETB-Eintrag                                        | Im Meldungseingang | In den Lagemeldungen    |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------- | ------------------ | ----------------------- |
| Meldungsformular, Art Lagemeldung | Meldung                                    | automatisch, Typ „Lage“ (wenn Auto-ETB an)         | ja                 | ja, sofort              |
| Meldungsformular, andere Art      | Meldung                                    | automatisch, Typ „Meldung“                         | ja                 | erst nach Übernahme     |
| „Lagemeldung erfassen“ (Seite)    | Meldung, Art vorbelegt                     | wie Formular                                       | ja                 | ja, sofort              |
| Gerät, „Lagemeldung“              | Meldung des Geräts                         | wie Formular                                       | ja                 | ja, sofort, „vom Gerät“ |
| ETB, Typ „Lage“                   | ETB-Eintrag + Meldung in einer Transaktion | genau dieser eine                                  | ja                 | ja, sofort              |
| ETB, Typ „Meldung“                | ETB-Eintrag + Meldung, Art „Sonstige“      | genau dieser eine                                  | ja                 | erst nach Übernahme     |
| ETB, „Nur protokollieren“         | nur ETB-Eintrag                            | dieser                                             | nein               | nein                    |
| „In die Lage übernehmen“          | Merkmal an bestehender Meldung             | System-Eintrag „in die Lage übernommen“ (LLH-1104) | bleibt             | ja                      |

## Migrationsweg `lage_meldung` (LLH-1031)

Eine Migration, Nummer vom Orchestrator (Anhängen, `scripts/check-migrationen.sh`). `UNIQUE
(meldung_id)` macht die Übernahme verlustfrei; nichts verweist per FK auf `lage_meldung`.

```sql
ALTER TABLE meldung ADD COLUMN lage_text TEXT;               -- NULL: der Wortlaut gilt
ALTER TABLE meldung ADD COLUMN lat REAL;
ALTER TABLE meldung ADD COLUMN lon REAL;
ALTER TABLE meldung ADD COLUMN lage_uebergeben_at TEXT;      -- NULL ⇔ lagerelevant = 0
ALTER TABLE meldung ADD COLUMN lage_uebergeben_von_id INTEGER REFERENCES benutzer(id);
ALTER TABLE meldung ADD COLUMN lage_gesehen_at TEXT;         -- Kenntnisnahme (LLH-1206)
ALTER TABLE meldung ADD COLUMN lage_gesehen_von_id INTEGER REFERENCES benutzer(id);

-- Bestand: übergebene Meldungen
UPDATE meldung SET
  lage_text = (SELECT NULLIF(lm.text, meldung.inhalt) FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lat = (SELECT lm.lat FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lon = (SELECT lm.lon FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_uebergeben_at = (SELECT lm.erstellt_at FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_uebergeben_von_id = (SELECT lm.erstellt_von_id FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_gesehen_at = (SELECT lm.gesehen_at FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lage_gesehen_von_id = (SELECT lm.gesehen_von_id FROM lage_meldung lm WHERE lm.meldung_id = meldung.id),
  lagerelevant = 1
WHERE id IN (SELECT meldung_id FROM lage_meldung);

-- Bestand: Lagemeldungen, die nie übergeben wurden — lagerelevant, gelten als gesehen (wie 0189)
UPDATE meldung SET lagerelevant = 1, lage_uebergeben_at = eingang_at,
       lage_uebergeben_von_id = erfasst_von_id, lage_gesehen_at = eingang_at
WHERE meldungsart = 'lagemeldung' AND lage_uebergeben_at IS NULL;

DROP TABLE lage_meldung;
CREATE INDEX idx_meldung_lage ON meldung(einsatz_id, lagerelevant);
```

Folgestellen, alle in LLH-1031:

| Stelle                                                      | Heute                                                                                 | Danach                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liste `GET …/lage/meldungen` (`meldung/repo.rs:900`)        | `lage_meldung JOIN meldung`, `ORDER BY lm.id DESC`                                    | `meldung WHERE lagerelevant = 1`, Ordnung nach Ereigniszeit (LLH-1039); Drahtform kompatibel: `id = meldung_id = meldung.id`, `text = COALESCE(lage_text, inhalt)`, `erstellt_at` = Übergabe |
| Kenntnisnahme (`repo.rs:934/:958`, Routen `app.rs:864–875`) | `{lid}` = Lageobjekt, `bis_id`                                                        | `POST …/meldungen/{mid}/lage-gesehen`, `POST …/lage/gesehen` mit `meldung_ids`; alte Pfade entfallen (ein altes Bundle schickte sonst Lageobjekt-ids als Meldungs-ids)                       |
| Modulzähler (`repo.rs:981`, `einsatz/zaehler.rs:316`)       | `COUNT(*) FROM lage_meldung WHERE gesehen_at IS NULL`                                 | dasselbe Prädikat an `meldung`, eine Abfrage (Spec `modul-zaehler`)                                                                                                                          |
| Lagekarte-Marker `src/geocoding/marker.rs:33`               | `SELECT 'lagemeldung', id, 'Lagemeldung', lat, lon FROM lage_meldung`                 | `… 'Lagemeldung #' \|\| lfd_nr … FROM meldung WHERE lagerelevant = 1 AND lat IS NOT NULL AND lon IS NOT NULL`; Kennung `lagemeldung:<meldung-id>` im Client                                  |
| Schwärzung `einsatz/schwaerzung_registry.rs:1008` / `:2083` | Regel `lage_meldung` (`text` Platzhalter, `lat/lon` behalten, Kenntnisnahme behalten) | Regel entfällt; an `meldung`: `lage_text` NullSetzen (Z_EINSATZ), `lat`/`lon` G_GEO, Zeiten G_ZEIT, `*_von_id` G_FK                                                                          |
| Purge `einsatz/purge_scheduler.rs:855–875`, `:969–977`      | übt Platzhalter an `lage_meldung.text`                                                | Lage-Text der Meldung ist nach Phase B weg; Platzhalter an einer anderen NOT-NULL-Spalte prüfen                                                                                              |
| Lage-Stände `lage_snapshot/repo.rs:207/:309`                | JSON mit `LageMeldungAnzeige` (alte Kennungen)                                        | alte Stände bleiben, wie sie sind; `baueLageMeldungMarker` liest beide Formen (neue Felder optional); geschwärzt wie bisher über die Regel `lage_snapshot`                                   |
| Ohne Netz `api/queryKeys.ts:1298` (`LAGEBILD_OFFLINE`)      | Liste auf der Platte, Freitexte `text`, `meldung_absender`                            | gleich; keine weiteren Freitexte in der Antwort (kein `inhalt` neben `text`, kein `empfaenger`), sonst Eintrag in `lagebildKuerzung`                                                         |
| `MeldungAnzeige.lage_meldung_id` (`meldung/mod.rs:145`)     | Rückverweis aufs Lageobjekt                                                           | entfällt; `lagerelevant` trägt die Aussage                                                                                                                                                   |

## Zustände der Seite „Lagemeldungen“ (Textskizzen)

Fükw 1440 × 900, Nachtbetrieb:

```
Lage › Lagemeldungen
Lagemeldungen   24 Lagemeldungen · 3 neu         [Alle als gesehen markieren] [Lagemeldung erfassen]
[Suche …        ] [Alle|Letzte Stunde|4 Stunden|Heute] [Ort: alle ▾] [Herkunft: Alle|Gerät|Übernommen]
┌ 3 neue Lagemeldungen anzeigen ──────────────────────────────────────────────────────────────────┐
DIENSTAG, 21. OKTOBER
▌LAGE 1430  Florian Musterstadt 3/1 · Funk                         [Neu] dringend
▌           Brand in Halle 2 unter Kontrolle, Nachlöscharbeiten laufen, zwei Verletzte an UHS.
▌           52.37 N 9.73 E · Auf Lagekarte ↗ · 120 m NO von Lagemeldung #9         Meldung #12 · In Bearbeitung ↗
▌LAGE 1412  UHS Nord · Laptop 1 (Gerät)                            gesehen 1415 · Meier
▌           Zwei Patienten SK II übernommen, Platz 4 belegt.                        Meldung #11 ↗
▌LAGE 1349  ELW 1 → Leitstelle · extern                            gesehen 1352 · Meier
▌           Lagemeldung an übergeordnete Stelle: …                                  Meldung #10 · Erledigt ↗
```

- Eine Marke „Neu“ je Zeile, nur für die Kenntnisnahme. Der Bearbeitungsstand der Meldung steht am
  Sprung und fehlt, solange sie „neu“ ist — nie zweimal „Neu“ in einer Zeile.
- „Lagemeldung erfassen“ öffnet ein Paneel über der Zeitachse mit dem `MeldungFormular`, Art
  „Lagemeldung“ vorbelegt; nach dem Erfassen schließt es, die neue Zeile steht oben.
- Leer: „Noch keine Lagemeldungen“ + „Lagemeldung erfassen“. Filter ohne Treffer: „Keine
  Lagemeldung passt zum Filter“ + „Filter zurücksetzen“. Laden: Skelett. Fehler: „Lagemeldungen
  konnten nicht geladen werden“ + „Erneut laden“.
- Ohne Schreibrecht im Modul Meldungen: kein „Lagemeldung erfassen“, im Kopf „Nur Ansicht · Kein
  Schreibrecht für Meldungen“. Ohne Schreibrecht an den Lagemeldungen: keine Kenntnisnahme-Knöpfe,
  die Marke „Neu“ bleibt sichtbar.
- Führungs-Tablet 1280 × 800 Handschuh: Ziele ≥ 72 px, Filter umbrechen in zwei Zeilen, kein
  waagrechter Überlauf. Handy 390 px: Wortlaut zuerst, Meta darunter, Filter hinter „Filter (n)“,
  „Lagemeldung erfassen“ als Primärknopf im Kopf.

ETB-Erfassungsleiste bei Typ „Lage“ (ab `md`):

```
[Lage ▾] Brand in Halle 2 unter Kontrolle …                     [Von: Florian 3][An: ELW 1] [Erfassen ↵]
Werte behalten ☐   Nur protokollieren ☐   Als strukturierten Lagebericht erfassen →
```

Ohne Recht für Meldungen: „Nur protokollieren ☑“ gesperrt, Grund „Kein Schreibrecht für
Meldungen“. Der Schalter steht in der Hinweiszeile wie „Werte behalten“, das Feld bleibt ≥ 60 %
der Zeile (`frontend/src/etb/AGENTS.md`).

## Prompt für Claude Design

Grundlage: Design System „Lifeline Hub“ (Adresse in `docs/design/design-system/ARTIFACT.md`).
Aus LLH-1031, angepasst an die Entscheidung: eine Marke „Neu“ für die Kenntnisnahme, der
Bearbeitungsstand der Meldung am Sprung; Herkunft „Gerät“/„Übernommen“ statt „Funk“ (Funk ist der
Meldeweg, kein Ursprung); Handschuh-Ziele ≥ 72 px nach der Dichte-Staffel 30/48/72 (der
Ticket-Prompt nannte 48 px). Den Entwurf legt ein Agent mit claude.ai-Zugang hier als
`lagemeldungen.dc.html` ab.

```
Design System „Lifeline Hub“ (Instrumententafel, Nachtbetrieb als Vorgabe, Radius 0, Archivo/JetBrains Mono, Bedienfarbe blau, Rot nur Gefahr).
Entwirf die Seite „Lagemeldungen“ (Kategorie Lage) einer BOS-Führungsunterstützung neu. Zweck: S2/Einsatzleitung liest in zeitlicher Folge alle lagerelevanten Meldungen und erfasst selbst eine Lagemeldung. Jede Lagemeldung ist eine Meldung; die Seite ist eine Sicht, kein eigener Bestand.
Daten je Zeile: Ereigniszeit als taktische Zeit (z. B. 101430okt26), Absender (Funkrufname/Stelle, ggf. gekoppeltes Gerät „UHS Nord · Laptop 1“), Meldungsart-Kante „Lage“ (bei einer übernommenen anderen Art deren Wort, z. B. „Rückmeldung“), Priorität (Sofort/Dringend/Normal, Normal ohne Etikett), Richtung „extern“ als Merkmal bei einer Lagemeldung an die übergeordnete Stelle, Lage-Text (mehrzeilig, Hauptinhalt), optional Verortung (Koordinate + „Auf Lagekarte ↗“ + Ortsbezug „120 m NO von Lagemeldung #9“), Kenntnisnahme als einzige Marke „Neu“ bzw. „gesehen 1415 · Meier“, Sprung „Meldung #12 ↗“ mit dem Bearbeitungsstand der Meldung als Wort dahinter („Meldung #12 · In Bearbeitung ↗“), der fehlt, solange die Meldung neu ist; mit Schreibrecht „Als gesehen markieren“ an neuen Zeilen.
Kopf: Titel, Zähler „24 Lagemeldungen · 3 neu“, „Alle als gesehen markieren“, Primäraktion „Lagemeldung erfassen“ (öffnet ein Inline-Paneel über der Zeitachse mit dem Meldungsformular, Art „Lagemeldung“ vorbelegt: Absender, Empfänger, Meldeweg, Wortlaut, Priorität, Ereigniszeit, optional Lage-Text und Koordinate). Filter: Suche, Zeitfenster (Alle/Letzte Stunde/4 Stunden/Heute), Ort (alle/mit/ohne Koordinaten), Herkunft (Alle/Gerät/Übernommen).
Gruppen je Tag, jüngster zuerst; neue Einträge per Sammelbanner („3 neue Lagemeldungen anzeigen“), nie unter dem Cursor eingeschoben.
Zustände: Laden (Skelett), Fehler mit „Erneut laden“, leer mit „Lagemeldung erfassen“, Filter ohne Treffer mit „Filter zurücksetzen“, ohne Schreibrecht für Meldungen „Nur Ansicht · Kein Schreibrecht für Meldungen“ (kein Erfassen, Marke „Neu“ bleibt sichtbar).
Zusätzlich die ETB-Erfassungsleiste bei Typ „Lage“: Hinweiszeile mit „Werte behalten“, „Nur protokollieren“ (aus) und „Als strukturierten Lagebericht erfassen →“; dieselbe Leiste ohne Recht für Meldungen mit „Nur protokollieren“ an und gesperrt, Grund daneben.
Kontexte: Fükw 1440×900 kompakt, Führungs-Tablet 1280×800 mit Handschuh-Dichte (Ziele ≥ 72 px), Handy 390 px (Wortlaut zuerst). Keine Tabelle, eine Zeitachse. Kein erklärender Text unter dem Titel. Tag- und Nachtbetrieb, Text ≥ 7:1 Tag, ≥ 5:1 Nacht; „Neu“ trägt Wort und Farbe, nie Farbe allein.
```
