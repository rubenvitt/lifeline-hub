---
titel: Material
gruppen: [fuehrung]
reihenfolge: 340
quellen: [frontend/src/pages/MaterialPage.tsx, frontend/src/kraefte/MaterialOrt.tsx, frontend/src/kraefte/EinheitAngabe.tsx, frontend/src/kraefte/einheitAngabeKern.ts, frontend/src/kraefte/MaterialVerdichtung.tsx, frontend/src/kraefte/materialVerdichtungKern.ts, frontend/src/kraefte/MaterialAngabenModal.tsx, frontend/src/kraefte/MaterialAufteilenModal.tsx, frontend/src/kraefte/EntlassenBlock.tsx, frontend/src/components/InlineAngabe.tsx, frontend/src/pages/uhs/MaterialTab.tsx, frontend/src/theme/statusFarben.ts, frontend/src/stammdaten/demoAuswahl.tsx, frontend/src/components/Erfassung.tsx, frontend/src/einsatz/schreibrecht.ts, src/routes/einsatz_material.rs, src/routes/einsatz_einheit.rs, src/material/mod.rs, src/material/disposition_repo.rs, migrations/0019_einsatz_material.sql]
---

## Überblick

Das Modul **Material** führt Geräte und Verbrauchsgüter, die im Einsatz sind: Posten aus dem
Materialstamm der Organisation und Ad-hoc-Material ohne Stammeintrag, etwa Spenden oder Material
einer fremden Organisation. Je Posten stehen Bezeichnung, Kategorie, Ort, Menge, Status und
Bemerkung. Der Ort nennt die Einheit und die UHS, bei der der Posten liegt.

Die Führung liest hier, was einsatzbereit, im Einsatz oder ausgefallen ist und wo es liegt.
Disponieren und ändern dürfen Einsatzleitung und Führungspersonal.

## Abläufe

### Die Materialliste lesen

1. Unter „Kräfte & Mittel“ „Material“ öffnen.
2. Die Zeile über der Liste zählt die Posten: „einsatzbereit“, „im Einsatz“ und „Ausfall“.
   „Meldebild“ führt ins Meldebild.

   ![Materialliste mit vier Posten; darüber „2 einsatzbereit · 1 im Einsatz · 1 Ausfall“, unter jeder Bezeichnung gedämpft die Kategorie, in der Spalte „Ort“ der Sanitätsrucksack bei „Sanitätszug Musterstadt“ und „UHS Turnhalle Musterstadt“, je Posten „Aus dem Einsatz nehmen“](../bilder/material/material.png)

3. Die Liste ist nach Status gruppiert. In „Bezeichnung, Kategorie, Ort“ suchen oder nach „Ort“
   und „Status“ filtern. Der Filter „Ort“ kennt „ohne Ort“, jede Einheit und jede UHS der Liste.
4. Auf schmaleren Schirmen, auch am Fükw, ist die Spalte „Kategorie“ ausgeblendet; die Kategorie
   steht dann gedämpft unter der Bezeichnung. „Spalten“ zeigt, wie viele Spalten fehlen, und
   blendet sie wieder ein.

### Material aus dem Stamm disponieren

Für Einsatzleitung und Führungspersonal:

1. „Material disponieren“ wählen.
2. Unter „Material“ einen Posten wählen und die „Menge“ eingeben.

   ![Dialog „Material disponieren“ mit dem Feldbettensatz und Menge 2](../bilder/material/material-disponieren.png)

3. „Disponieren“ wählen, oder „Speichern und nächste“ für den nächsten Posten.

### Ad-hoc-Material erfassen

Für Einsatzleitung und Führungspersonal, wenn ein Posten nicht im Materialstamm steht:

1. „Ad-hoc-Material“ wählen.
2. „Bezeichnung“ und „Menge“ eingeben, bei Bedarf „Kategorie“, „Trägerorganisation“ und unter
   „Weitere Angaben“ die „Bestandsnummer“.

   ![Dialog „Ad-hoc-Material ohne Stammeintrag“ mit Sandsäcken, Menge 200, Kategorie und Trägerorganisation](../bilder/material/adhoc-material.png)

3. „Disponieren“ wählen. Mit „Speichern und nächste“ und „Werte behalten“ bleiben Kategorie und
   Trägerorganisation für den nächsten Posten stehen.

Ad-hoc-Posten tragen in der Liste die Marke „ad-hoc“.

### Den Ort ändern

Für Einsatzleitung und Führungspersonal:

1. In der Spalte „Ort“ den Einheitsnamen wählen, oder „Einheit eintragen“, wenn der Posten noch
   keiner Einheit gehört.
2. Eine Einheit wählen, oder „keine Einheit“, um den Posten von seiner Einheit zu lösen.
3. „Speichern“ wählen. Escape oder „Abbrechen“ lässt den Ort unverändert.
4. Für die UHS ebenso: den UHS-Namen oder „UHS eintragen“ wählen, eine UHS oder „keine UHS“
   wählen und speichern. Angeboten werden geplante und aktive UHS; eine aufgelöste UHS, an der
   der Posten noch steht, steht gesperrt vorn in der Liste.

Einheit und UHS sind zwei getrennte Angaben: Wer die Einheit wechselt, lässt die UHS stehen, und
umgekehrt.

### Menge, Status und Bemerkung ändern

Für Einsatzleitung und Führungspersonal:

1. In der Spalte „Menge“ die Zahl wählen, die neue Menge eingeben und mit „Speichern“ oder Enter
   bestätigen. Verlassen ohne Speichern ändert nichts. Die Menge ist mindestens 1.
2. In der Spalte „Status“ einen Status wählen: einsatzbereit, im Einsatz, defekt, verbraucht oder
   Desinfektion nötig.
3. In der Spalte „Bemerkung“ „Bemerkung hinzufügen“ wählen und den Text eintragen.

### Angaben eines Ad-hoc-Postens korrigieren

Für Einsatzleitung und Führungspersonal, etwa bei einem Tippfehler in der Bezeichnung:

1. In der Zeile des Postens „Weitere Aktionen“ öffnen und „Angaben ändern“ wählen.
2. „Bezeichnung“, „Kategorie“, „Trägerorganisation“ oder unter „Weitere Angaben“ die
   „Bestandsnummer“ ändern. Ein geleertes Feld löscht die Angabe; die Bezeichnung ist Pflicht.

   ![Dialog „Angaben zu Spende-Decken ändern“ mit Bezeichnung, Kategorie, Trägerorganisation „Kleiderkammer“ und dem eingeklappten Teil „Weitere Angaben“](../bilder/material/angaben-aendern.png)

3. „Speichern“ wählen.

Bei einem Posten aus dem Materialstamm heißt der Eintrag „Angaben ändern · im Stamm pflegen“ und
ist gesperrt: seine Angaben stehen im Materialstamm.

### Einen Posten aufteilen

Für Einsatzleitung und Führungspersonal, wenn ein Teil der Menge woanders gebraucht wird:

1. In der Zeile des Postens „Weitere Aktionen“ öffnen und „Aufteilen“ wählen.
2. Unter „Menge abteilen“ die Menge für die neue Zeile eingeben, von 1 bis eins unter der
   Menge. Darunter steht das Ergebnis, etwa „Danach 30 + 20“.

   ![Dialog „Spende-Decken aufteilen“ mit „Menge abteilen“ 20 und dem Ergebnis „Danach 30 + 20“](../bilder/material/aufteilen.png)

3. „Aufteilen“ wählen. Die neue Zeile steht in der Liste; ihren Ort in der Spalte „Ort“ ändern.

Bei Menge 1 heißt der Eintrag „Aufteilen · Menge 1“ und ist gesperrt.

### Material aus dem Einsatz nehmen

Für Einsatzleitung und Führungspersonal, wenn ein Posten den Einsatz verlässt:

1. In der Zeile des Postens „Aus dem Einsatz nehmen“ wählen. Eine Rückfrage gibt es nicht.
2. Der Posten verlässt die Liste. Der Hinweis unten bietet einige Sekunden lang „Rückgängig“.
3. Unter der Liste „Aus dem Einsatz genommen“ aufklappen. Dort stehen alle herausgenommenen
   Posten mit Menge und Zeitpunkt.

   ![Aufgeklappter Block „Aus dem Einsatz genommen (1)“ unter der Materialliste mit einem Posten, seiner Menge, dem Zeitpunkt und dem Knopf „Erneut disponieren“](../bilder/material/aus-dem-einsatz.png)

4. Kommt der Posten zurück, „Erneut disponieren“ wählen.

### Eine Fehldisposition stornieren

Für Einsatzleitung und Führungspersonal, wenn ein Posten versehentlich disponiert wurde:

1. In der Zeile des Postens „Weitere Aktionen“ öffnen und „Stornieren“ wählen. Gehört der Posten
   einer Einheit oder einer UHS, steht dort „Stornieren · zugeordnet“ gesperrt; dann zuerst den
   Ort lösen oder den Posten aus dem Einsatz nehmen.
2. Die Rückfrage „… stornieren?“ mit „Stornieren“ bestätigen.
3. Lehnt die App ab, steht der Grund an der Zeile; der Posten lässt sich dann nur aus dem Einsatz
   nehmen.

## Hintergrund

### Ort: Einheit und UHS

Ein Posten kann bei einer Einheit und zugleich an einer UHS liegen; die Spalte „Ort“ zeigt dann
beides, etwa „Sanitätszug Musterstadt · UHS Turnhalle“. Die Einheit wird über das Modul
[Einheiten](einheiten.md) gespeichert, dasselbe wie die Zuordnung dort; die UHS gehört zum Posten.
Eine aufgelöste UHS nimmt kein Material mehr an; Material, das schon dort liegt, bleibt änderbar.
Im UHS-Reiter „Material“ ist „Material zuordnen“ an einer aufgelösten UHS gesperrt, mit dem Grund
„UHS aufgelöst“.

### Zählung

Die Zeile über der Liste zählt Posten, nicht Mengen, und immer die ganze Liste, auch wenn ein Filter
gesetzt ist. „Ausfall“ fasst defekt, verbraucht und Desinfektion nötig zusammen; nur diese Zahl ist
farbig, und nur, wenn sie über null liegt. Im Meldebild nennt die Zeile einer Einheit den Ausfall
ihres Materials nach derselben Regel; die Zahl der Kräfte im Meldebild zählt nur Personal und
Fahrzeuge (Kapitel [Meldebild und Kräfte-Zeitachse](meldebild.md)).

### Mehrere Posten derselben Art

Derselbe Stammposten lässt sich mehrmals disponieren, jeweils als eigene Zeile mit eigener Menge und
eigenem Status. Aufteilen macht aus einer Zeile zwei: Die neue Zeile übernimmt Status, Bemerkung,
Einheit, UHS und den Zeitpunkt der Disposition, die Ausgangszeile behält den Rest der Menge. Die
Auswahl beim Disponieren bietet den Materialstamm an, soweit er in Dienst steht; Demo-Posten stehen
in einer eigenen Gruppe am Ende.

### Status

Ein disponierter Posten beginnt mit „einsatzbereit“. Die fünf Statuswerte sind fest und gelten für
jede Organisation.

### Aus dem Einsatz nehmen und Stornieren

Aus dem Einsatz nehmen ist der Normalweg: Der Posten verlässt seine Einheit und eine UHS. In
Auswahllisten, im Meldebild und in der UHS zählt er nicht mehr; der Block „Aus dem Einsatz
genommen“ unter der Liste führt ihn weiter. Erneut disponiert, steht er wieder in der Liste, mit
derselben Menge und demselben Status; Einheit und UHS kommen nicht zurück. „Material disponieren“
legt dagegen immer eine neue Zeile an.

Stornieren korrigiert eine Fehldisposition und lässt keine Spur. Es geht nur in den ersten 15
Minuten nach der Disposition und nur, solange der Posten keiner Einheit und keiner UHS zugeordnet
ist. Wer einmal aus dem Einsatz genommen war, lässt sich auch nach dem erneuten Disponieren nicht
mehr stornieren. Ein stornierter Posten erscheint in keiner Liste. Eine durch Aufteilen entstandene
Zeile hat dieselbe Frist wie ihre Ausgangszeile.

An einem herausgenommenen oder stornierten Posten lässt sich nichts mehr ändern: Menge, Status,
Bemerkung, Angaben und Ort setzen sowie aufteilen lehnt die App ab.

### Einsatztagebuch

Disponieren, jede Mengen- und Statusänderung, das Herausnehmen, das erneute Disponieren und das
Stornieren stehen im Einsatztagebuch, mit alter und neuer Menge bzw. altem und neuem Status. Dazu:

- Einheit wechseln: „Einheit «Staffel B»: Material «Wolldecke» (×20) zugeordnet, vorher
  «Staffel A»“; von der Einheit lösen: „Einheit «Staffel A»: Material «Wolldecke» (×20)
  freigegeben“.
- Aufteilen: „Material «Wolldecke» aufgeteilt: 50 → 30 + 20“.
- Angaben ändern: ein Eintrag, der jede geänderte Angabe mit altem und neuem Wert nennt.

Eine Bemerkung und die UHS eines Postens ändern das Einsatztagebuch nicht.

### Rechte und ohne Netz

Lesen darf, wer das Modul Material sieht. Disponieren, ändern, aufteilen, aus dem Einsatz nehmen und
stornieren dürfen Einsatzleitung und Führungspersonal, solange der Einsatz läuft (Kapitel
[Rechte im Einsatz](rechte-im-einsatz.md)). Die Einheit im Ort ändert nur, wer auch das Modul
Einheiten nutzen darf, die UHS nur, wer das Modul Unfallhilfsstellen nutzen darf; sonst ist der
jeweilige Teil nur lesbar. Wer ein Modul nicht sieht, liest an seiner Stelle „zugeordnet“.
Ohne Netz bleibt die Liste mit dem zuletzt geladenen Stand lesbar; ändern lässt sich nichts (Kapitel
[Ohne Netz](ohne-netz.md)).
