# Vertrag „Stammdaten-Datei“

Eine neutrale Datei, mit der eine andere Anwendung (Fahrzeugverwaltung, Mitgliederverwaltung,
selbst gepflegte Tabelle) Fahrzeuge, Personal und Qualifikationen an Lifeline Hub übergibt. Lifeline
kennt nur diesen Vertrag, keine Anwendung beim Namen. Ein Export, der ihn erfüllt, genügt.

Eingelesen wird unter **Stammdaten → Fahrzeuge** oder **Stammdaten → Personal** mit dem Knopf
„Stammdaten einlesen“: Datei wählen, Vorschau ansehen, „Übernehmen“. Die Vorschau schreibt nichts;
„Übernehmen“ schreibt alles oder nichts. Der Weg steht nur Admins offen und nur am Hub oder auf einer
ungekoppelten Instanz; eine Instanz, die sich bei einem Hub meldet, bekommt 409.

Schnittstelle: `POST /api/master-data/import/preview` und `POST /api/master-data/import`
(multipart: `datei`, optional `herkunft`, optional `entscheidungen` als JSON). Die Typen stehen in
`openapi.json`.

## Dateiform

- **CSV**: eine Art je Datei. Trennzeichen `;`, `,` oder Tab (erkannt aus der Kopfzeile), UTF-8
  (sonst Windows-1252 mit Hinweis).
- **XLSX**: ein Blatt je Art, Blattnamen `Fahrzeuge`, `Personal`, `Qualifikationen` (Groß-/Kleinschreibung
  egal). Fehlende Blätter sind erlaubt, andere Blätter werden mit einem Hinweis übergangen.
- **Kopfzeile Pflicht.** Spaltenköpfe gelten ohne Rücksicht auf Groß-/Kleinschreibung; Leerzeichen,
  `_` und `-` entfallen (`Funk-Rufname` = `funkrufname`). Umlaute werden nicht umgeschrieben: die
  Köpfe sind ASCII, also `traegerorganisation`, nicht `trägerorganisation`.
- **Grenzen:** 2 MiB je Datei, 5.000 Zeilen je Art, entpackte XLSX höchstens 64 MiB.
- Werte werden getrimmt. Eine leere Zelle heißt „keine Angabe“, nie „leeren“.
- **Nur diese Spalten.** Jede andere Spalte wird nicht gelesen; die Vorschau zählt ihren Kopf als
  „nicht übernommen“ auf (nie die Werte). Personenbezogene Felder, die Lifeline nicht nutzt, gehören
  nicht in die Datei.

### Arterkennung bei CSV

Der Server erkennt die Art an den Spaltenköpfen: `funkrufname` → Fahrzeuge, `name` → Personal,
`bezeichnung` ohne `name` → Qualifikationen. Ist das nicht eindeutig, antwortet er mit 400 und einer
Meldung. Bei XLSX bestimmt der Blattname die Art.

## Spalten

Gemeinsam für jede Art:

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `kennung` | nein | stabile ID des Datensatzes in der Quelle, höchstens 100 Zeichen |
| `herkunft` | nein | Name der Quelle, höchstens 100 Zeichen; fehlt die Spalte, gilt die Herkunft aus der Eingabe beim Hochladen |

Eine Zeile mit `kennung` braucht eine Herkunft (Spalte oder Eingabe), sonst 400 „Herkunft angeben“.
Ohne `kennung` wird die Zeile trotzdem abgeglichen, aber nichts gemerkt; die Vorschau weist darauf
hin.

**Fahrzeuge**

| Spalte | Pflicht | Ziel |
|---|---|---|
| `funkrufname` | ja | Funkrufname |
| `kennzeichen` | nein | Kennzeichen |
| `opta` | nein | OPTA des Fahrzeugfunkgeräts |
| `issi` | nein | ISSI des Fahrzeugfunkgeräts |
| `typ` | nein | Fahrzeugtyp |
| `standort` | nein | Standort |

Je Zeile genau ein OPTA und ein ISSI: das Fahrzeugfunkgerät. Welches Gerät das ist, entscheidet der
liefernde Export. Lifeline führt keine Gerätetabelle.

**Personal**

| Spalte | Pflicht | Ziel |
|---|---|---|
| `name` | ja | Name, „Nachname, Vorname“ oder frei |
| `personalnummer` | nein | Personalnummer |
| `telefon` | nein | Telefon |
| `traegerorganisation` | nein | Trägerorganisation |
| `qualifikationen` | nein | Liste, getrennt mit `;`: Kennungen der Quelle oder Bezeichnungen |

Bei CSV mit `;` als Trennzeichen steht die Liste in Anführungszeichen: `"q-san; q-fue"`.

**Qualifikationen** (optional; erlaubt, die Bezeichnungen der Quelle vorab zu liefern)

| Spalte | Pflicht | Ziel |
|---|---|---|
| `bezeichnung` | ja | Bezeichnung der Qualifikation |

## Abgleich

Je Zeile in fester Reihenfolge, die erste Stufe mit Treffer gilt. Verglichen wird nur mit
Datensätzen der eigenen Organisation, die im Dienst stehen.

| Art | Reihenfolge |
|---|---|
| Fahrzeug | Kennung + Herkunft → OPTA → ISSI → Funkrufname |
| Personal | Kennung + Herkunft → Personalnummer → Name |
| Qualifikation | Kennung + Herkunft → Bezeichnung |

- OPTA, ISSI und Personalnummer werden für den Vergleich normalisiert (Leerzeichen entfallen,
  Kleinschreibung). Mehr als ein Treffer auf einer Stufe ist **mehrdeutig**; die Stufe darunter wird
  dann nicht mehr befragt.
- Name: enthält er ein Komma, gilt „Nachname, Vorname“, sonst ist das letzte Wort der Nachname.
- Trifft eine Kennung einen außer Dienst gestellten Datensatz, wird die Zeile ausgelassen
  (Hinweis); nichts wird reaktiviert.
- Eine **inaktive** Qualifikation wird gefunden und verknüpft, bleibt aber inaktiv.
- Eine Zeile, die über OPTA, ISSI, Personalnummer oder Name ein Ziel trifft, das für dieselbe
  Herkunft schon eine **andere** Kennung trägt, ist mehrdeutig; nie wird still umgehängt.
- Zwei Zeilen derselben Datei mit gleicher Kennung und Herkunft sind beide Fehler.
- Ein gefundener Datensatz ohne gemerkte Kennung bekommt sie beim Übernehmen.
- Qualifikationen am Personal werden hinzugefügt, nie entfernt.

## Zweiter Lauf

Dieselbe Datei ein zweites Mal ändert nichts („unverändert“). Eine Datei mit neuen Werten:

- **Leere Felder werden gefüllt.**
- Ein schon gefülltes Feld mit anderem Wert ist ein **Hinweis** in der Vorschau; je Zeile kann der
  Admin „Datei übernehmen“ wählen. Standard ist „Lifeline behalten“. Nichts wird still überschrieben.
- Die Erkennungsfelder (Fahrzeug: `funkrufname`, `opta`, `issi`; Personal: `name`, `personalnummer`)
  gehören nur dann zu „Datei übernehmen“, wenn die Zeile über Kennung + Herkunft gefunden wurde;
  sonst bleibt die Abweichung ein Hinweis.
- **Nichts wird gelöscht oder stillgelegt.** Fehlt ein Datensatz in einer späteren Datei, bleibt er.
- Eine unbekannte Qualifikation wird neu angelegt, einer eigenen Qualifikation zugeordnet oder
  ausgelassen. Eine Zuordnung wird je Quelle gemerkt und gilt im nächsten Lauf ohne Rückfrage.
- Ein Fehler in einer Zeile (zum Beispiel ein Funkrufname, den ein anderes Fahrzeug im Dienst
  trägt) sperrt das ganze Übernehmen, bis er behoben oder die Zeile ausgelassen ist.

## Musterdateien

Die Musterdateien liegen dort, wo die Oberfläche sie anbietet; sie werden nicht kopiert:

- `frontend/public/beispiele/stammdaten-beispiel.csv`: nur Fahrzeuge, `;`-getrennt.
- `frontend/public/beispiele/stammdaten-beispiel.xlsx`: alle drei Blätter, Personal mit
  Qualifikationsliste, dazu das Blatt `Qualifikationen`.

Alle Namen, Nummern und Kennungen sind erfunden. Die Excel-Datei erzeugt der Test
`muster_xlsx_schreiben` in `tests/stammdaten_eingang.rs` aus der Tabelle `MUSTER_BLAETTER`:

```
cargo test --test stammdaten_eingang muster_xlsx_schreiben -- --ignored
```

`muster_xlsx_entspricht_der_tabelle` hält die eingecheckte Datei daran fest, `musterdateien_lesbar`
liest beide Dateien und prüft, dass die Vorschau keine Meldung zeigt und ein zweiter Lauf nichts
ändert. Ausschnitt der CSV:

```
kennung;herkunft;funkrufname;kennzeichen;opta;issi;typ;standort
fz-001;Musterquelle;RK Musterstadt 1/83-1;MS-RK 101;4-83-1;1234501;RTW;Wache Nord
```
