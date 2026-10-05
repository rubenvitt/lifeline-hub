# Design

## Context

Der Einsatzbericht (LFH-726, `openspec/changes/archive/2026-10-01-lfh-726-einsatzbericht/design.md`)
besteht aus drei reinen Schichten und einer Seite:

- `druck/einsatzbericht/quellen.ts`: Blockliste `BLOECKE`, Quellentabelle `QUELLEN` (jede Quelle
  hängt an genau **einem** Block) und die Freigabe-Weiche `berichtFreigabe`.
- `druck/einsatzbericht/abruf.ts`: lädt alle Quellen auf `abrufen` in einem Schnappschuss.
- `druck/einsatzbericht/verdichtung.ts`: baut daraus das `Einsatzbericht`-Objekt, immer mit
  allen sieben Blöcken; `Bloecke.tsx` bildet es nur ab.
- `pages/EinsatzberichtDruckPage.tsx`: Weiche → Abruf über `einsatzKeys.einsatzberichtDruck(id)`
  → Druckkopf mit „Stand“ und ggf. „Vorläufig“ → Blöcke.

Vorbild für eine Auswahl in Adresse und Kopf ist der ETB-Druck (`etb/druckAuswahl.ts`,
`routing/deeplinks.ts` `etbDruckPfad`/`parseEtbFilter`). `frontend/AGENTS.md`: „Filter gehören in
die URL“, unbekannte Werte werden ganz verworfen.

Was und warum: `proposal.md`. Verhalten: `specs/einsatzbericht/spec.md`.

## Goals / Non-Goals

**Goals:**

- Ohne Parameter entsteht Wort für Wort der Bericht aus LFH-726, plus die Umfangszeile im Kopf.
- Die Auswahl ist eine reine Funktion (Adresse → Menge → Kopfzeile), ohne DOM testbar.
- Die Weiche bleibt an genau einer Stelle und wird nur um die Auswahl erweitert.

**Non-Goals:**

- Eine gespeicherte Vorlage je Organisation oder Benutzer („mein Abrechnungsbericht“). Die
  Adresse ist teilbar und als Lesezeichen speicherbar; das reicht für den Anfang.
- Abschnitte innerhalb eines Blocks wählen (etwa nur Schäden aus der Bilanz).
- Fahrzeuge mit Einsatzzeiten (D5).

## Decisions

### D1 Positivliste `?bloecke=` in kanonischer Reihenfolge

Die Adresse trägt die gewählten Blöcke als Positivliste:
`einsatzberichtPfad(id, auswahl?)` → `…/einsatzdaten/bericht?bloecke=stammdaten,zeiten,kraefte`.
`parseBerichtAuswahl(searchParams)` liest sie zurück. Die Funktion verwirft unbekannte und
doppelte Schlüssel und ordnet nach `BLOECKE`. Bleibt nichts übrig oder fehlt der Parameter,
gilt der Standardumfang. Entspricht die Auswahl genau dem Standardumfang, schreibt der
Pfadhelfer keinen Parameter. So bleibt die Adresse des Einstiegs (Einsatzdaten, Palette)
unverändert.

*Verworfen:*
- **Negativliste `?ohne=bilanz`:** Sie kann die optionalen Anlagen nicht ausdrücken, die
  standardmäßig fehlen. Dafür bräuchte es einen zweiten Parameter `?mit=`, also zwei Achsen
  für eine Menge.
- **Ein Parameter je Block (`?bilanz=0`):** Ein unbekannter Parameter fiele dann nicht als
  „unbekannter Schlüssel“ auf, sondern würde still ignoriert. Außerdem ist die Adresse länger.

### D2 Blockliste mit Standard und Anlagen, Quelle an mehreren Blöcken

`BLOECKE` bekommt zwei Einträge und ein Feld `standard: boolean`:

| Schlüssel | Titel | Standard |
|---|---|---|
| `stammdaten` … `etb` | wie LFH-726 | ja |
| `einheiten-zeiten` | Anlage Einheiten mit Einsatzzeiten | nein |
| `personal-kopf` | Anlage Personal je Kopf | nein |

Die Anlagen stehen am Ende. Der Bericht liest sich dann zuerst als Zusammenfassung, die langen
Listen folgen danach. Eine Personalliste mit hundert Zeilen zwischen Kräften und Lage zerrisse
den Bericht.

`Quelle.block` wird zu `bloecke: BlockSchluessel[]`. `personal` und `personalPerioden` speisen
Kräfte **und** die Personal-Anlage. `einheiten` und `einheitenPerioden` speisen Kräfte und die
Einheiten-Anlage, `einheiten` zusätzlich die Personal-Anlage, denn sie liefert die Spalte
Einheit. Der bestehende Abgleichtest mit `modulRegistry` bleibt. Dazu kommt ein Test, dass
jeder Block mindestens eine Quelle hat und jede Quelle mindestens einen Block.

### D3 Weiche und Abruf nur für gewählte Blöcke

`berichtFreigabe(freigaben, auswahl)` wertet nur Quellen aus, deren `bloecke` die Auswahl
schneiden. Alle übrigen Quellen bekommen einen vierten Zustand `nicht-gewaehlt`. `abruf.ts`
ruft dafür nichts ab, so wie bei `nicht-genutzt`. Die Verdichtung baut nur die gewählten
Blöcke.

Der Schnappschuss-Key bekommt die Auswahl als zweites Glied:
`einsatzKeys.einsatzberichtDruck(id, auswahlSchluessel)`. `auswahlSchluessel` ist die kanonische,
kommagetrennte Liste. Der Präfix in `NICHT_LIVE_KEYS` bleibt gleich. Eine geänderte Auswahl
lädt einen neuen Schnappschuss mit neuem Stand. Die Optionen bleiben wie beim ETB-Druck, dessen
Key ebenfalls den Filter trägt.

*Verworfen: immer alles abrufen und nur die Darstellung filtern.* Das Umschalten ginge ohne
Neuladen, aber ein gesperrtes Modul sperrte weiter den ganzen Bericht. Das ist genau der Fall,
den die Auswahl lösen soll (Spec „Gesperrtes Modul abgewählt“). Außerdem lüde die Seite
Personendaten, die sie nicht druckt. Das widerspricht der Datensparsamkeit, die der
Personendruck sonst durchhält.

### D4 Auswahlleiste am Bildschirm, Umfang im Kopf

Über der Druckwurzel, also außerhalb des Ausdrucks, steht ein Paneel „Blöcke“ mit zwei
Checkbox-Gruppen: „Bericht“ (die sieben Standardblöcke) und „Anlagen“. Bei der Personal-Anlage
steht der Hinweis „enthält Namen von Einsatzkräften“. Ein Klick schreibt die Adresse per
`setSearchParams(…, { replace: true })`. Der Zurück-Knopf des Browsers springt also nicht durch
jede Häkchenänderung. Ist nur noch ein Block gewählt, ist sein Häkchen gesperrt. Ein Knopf
„Standardumfang“ setzt die Auswahl zurück.

Der Druckkopf bekommt die Zeile `Umfang` aus `umfangZeile(auswahl)`: „Standardumfang“ oder
„Auswahl: Stammdaten, Kräfte, Anlage Personal je Kopf“. Ist die Personal-Anlage gedruckt,
kommt die Zeile `Personenbezug: enthält Namen von Einsatzkräften` dazu. Gesperrte Sackgasse,
Fehler und Laden bleiben wie in LFH-726. Die Sackgasse nennt nur Module der gewählten Blöcke und
weist darauf hin, dass sich Blöcke abwählen lassen. Die Auswahlleiste bleibt deshalb auch in der
Sackgasse sichtbar.

### D5 Anlagen aus der Kräfte-Zeitachse, keine Fahrzeugzeiten

- **Einheiten mit Einsatzzeiten:** Je Einheit mit mindestens einer Periode stehen Name
  (Funkrufname, falls vorhanden), Beginn der ersten Periode, Ende der letzten Periode bzw.
  „läuft“ und die Einsatzzeit aus `kraftDauern(perioden, bisMs).gesamtMinuten` mit `dauerText`.
  `bisMs` ist wie in D6 von LFH-726 der Stand, höchstens der Abschluss. Sortiert wird nach
  Beginn. Einheiten ohne Periode stehen nicht in der Tabelle. Ein Vermerk nennt ihre Zahl
  („für 2 Einheiten keine Zeitachse erfasst“).
- **Personal je Kopf:** Je `listeEinsatzPersonal`-Eintrag stehen `name`, `funktion`, der Name
  der Einheit (über `einheit_id` aus `einheiten`; ohne Zuordnung „—“), Beginn, Ende und
  Einsatzzeit aus `personalPerioden`. Sortiert wird nach Einheit, dann Name. Ohne Periode steht
  „keine Zeitachse“, nie 0. Darunter steht die Summe als Helferstunden, gleich gerechnet wie
  im Block Kräfte. Beide Zahlen müssen übereinstimmen, ein Test prüft das.

**Personenbezug:** Die Anlage nennt Einsatzkräfte, keine Betroffenen. Die Spec-Regel „Keine
personenbezogenen Daten Betroffener“ bleibt unberührt. Zweck ist der Helfernachweis für
Freistellung, Verdienstausfall und Abrechnung. Dafür reichen Name, Funktion, Einheit und Zeiten.
Kontaktdaten, Stamm-Personalnummer, Trägerorganisation und Status gelangen nicht in die
Verdichtung (Whitelist der Felder, wie D5 in LFH-726). Die Anlage ist standardmäßig aus, braucht
das Leserecht am Modul Personal, das dieselben Namen am Bildschirm zeigt, und der Kopf vermerkt
den Personenbezug. Ein Zugriffsprotokoll wie beim Personendruck (`person_zugriff_audit`) gilt nur
für Betroffene und wird hier nicht eingeführt. Das Modul Personal protokolliert auch das Lesen
der Liste nicht.

*Verworfen: Fahrzeuge mit Einsatzzeiten.* Fahrzeuge haben keine Zeitachse (`kraefte/zeitachse.ts`
kennt nur Einheiten und Personen). Eine Zeit über `fahrzeug.einheit_id` aus der Einheit
abzuleiten, behauptete eine Bindung, die niemand erfasst hat („Keine erfundenen Daten“,
`frontend/AGENTS.md`). Braucht es das, ist eine Fahrzeug-Zeitachse im Backend ein eigener Task.

## Risks / Trade-offs

- **[Umschalten lädt neu]** Jede Änderung der Auswahl holt bis zu fünfzehn Quellen neu. → Das
  geschieht nur auf Klick, nicht live, und der neue Stand steht im Kopf. In der Regel wählt man
  einmal und druckt dann.
- **[Unvollständiger Bericht wirkt vollständig]** Ein Bericht ohne Bilanz könnte beim Empfänger
  als ganzer Bericht durchgehen. → Der Kopf sagt „Auswahl: …“ statt „Standardumfang“.
- **[Personalliste geteilt]** Eine geteilte Adresse mit `personal-kopf` zeigt Namen. → Sie zeigt
  sie nur Personen mit Leserecht am Personal, die dieselben Namen ohnehin sehen. Die Weiche
  prüft je Betrachter.
- **[Doppelte Rechnung der Helferstunden]** Block Kräfte und Personal-Anlage rechnen beide aus
  `personalPerioden`. → Beide rechnen über dieselbe Hilfsfunktion, ein Test sichert die
  Gleichheit.

## Migration Plan

Nur das Frontend, additiv. Alte Adressen ohne Parameter zeigen den Standardumfang. Rückweg ist,
Parameter, Auswahlleiste und Anlagen zu entfernen. Es gibt keine Daten- oder API-Migration.
