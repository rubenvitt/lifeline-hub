---
titel: Evakuierung
gruppen: [alle, fuehrung]
reihenfolge: 525
quellen: [frontend/src/pages/EvakuierungPage.tsx, frontend/src/betreuung/BezirkTabelle.tsx, frontend/src/betreuung/EvakuierungKennzahlen.tsx, frontend/src/betreuung/useBezirkHandlungen.tsx, frontend/src/betreuung/BetreuungDialoge.tsx, frontend/src/betreuung/MeldeVerlauf.tsx, frontend/src/betreuung/betreuungText.ts, frontend/src/betreuung/evakuierungKennzahl.ts, frontend/src/theme/statusFarben.ts, src/routes/evakuierung.rs, src/betreuung/repo.rs]
---

## Überblick

Das Modul „Evakuierung“ führt die **Evakuierungsbezirke**: wie viele Personen ein Gebiet verlassen
sollen und wie viele es schon verlassen haben. Gezählt wird ohne Namen: Meldungen nennen nur
Zahlen. Wo die Evakuierten unterkommen, führt das Modul „Betreuung“
([Betreuung](betreuung.md)).

Der Kopf der Seite zählt die Bezirke. Darunter steht „Räumung in Zahlen“, darunter die Tabelle der
Bezirke.

## Abläufe

### Die Räumung ablesen

1. Im Modulpanel „Evakuierung“ öffnen.

   ![Seite „Evakuierung“ mit dem Band „Räumung in Zahlen“ und einer Tabelle mit zwei Bezirken](../bilder/evakuierung/uebersicht.png)

2. Das Band oben fasst die aktiven Bezirke zusammen: „Evakuiert“ mit dem Anteil an der Planung,
   „Geplant“, „Räumung läuft“ (mit der Zahl der nur angeordneten Bezirke), „Geräumt“ und „Ohne
   Meldung“.
3. Die Tabelle nennt je Bezirk den Räumungszustand („angeordnet“, „läuft“, „geräumt“,
   „aufgehoben“), evakuiert von geplant, die Zeit des letzten Stands, die Sammelstelle, die
   zugeordneten Flächen der Lagekarte und den Einsatzabschnitt. „≈“ kennzeichnet eine geschätzte
   Zahl. Der Filter „Räumung“ engt die Tabelle ein.
4. „Verlauf“ an einem Bezirk klappt alle Standmeldungen dazu auf.

### Einen Evakuierungsbezirk anlegen

1. „Evakuierungsbezirk anlegen“ wählen.
2. Unter „Bezeichnung“ das Gebiet nennen, etwa Straße und Hausnummern, ohne Namen von Bewohnern.
3. Die „Plangröße (Personen)“ eintragen und unter „Erhebung“ angeben, ob sie „gezählt“ oder
   „geschätzt“ ist.
4. Unter „Weitere Angaben“ bei Bedarf „Einsatzabschnitt“, „Sammelstelle“ und „Notiz“ ergänzen.

   ![Dialog „Evakuierungsbezirk anlegen“ mit Bezeichnung, Plangröße, Erhebung und Sammelstelle](../bilder/evakuierung/bezirk-anlegen.png)

5. „Anlegen“ wählen. Der Bezirk steht auf „angeordnet“.

### Den Stand eines Bezirks melden

1. Am Bezirk „Stand melden“ wählen. Der Dialog nennt den bisherigen Stand.
2. Unter „Evakuiert gesamt (Personen)“ die Gesamtzahl eintragen, nicht den Zuwachs, und die
   „Erhebung“ angeben (vorgewählt „gezählt“).

   ![Dialog „Stand melden: Mühlbachweg 1–40“ mit bisherigem Stand, Anzahl und Erhebung](../bilder/evakuierung/stand-melden.png)

3. Liegt die Meldung zurück, unter „Weitere Angaben“ den „Zeitpunkt“ eintragen; leer gilt jetzt.
4. „Melden“ wählen. Direkt danach bietet die Bestätigung „Rückgängig“ an.
5. Ändert sich die Lage, im Menü des Bezirks „Räumung setzen“ wählen und den
   „Räumungszustand“ setzen. „Plangröße fortschreiben“ ändert die Plangröße.

### Einen Bezirk auf der Lagekarte zeigen

1. Im Menü des Bezirks „Auf Karte zeigen“ wählen. Der Eintrag steht nur an Bezirken, denen auf
   der Lagekarte mindestens eine Fläche zugeordnet ist.
2. Die Lagekarte öffnet mit einer Fläche des Bezirks ausgewählt.

Umgekehrt führt die Auswahl einer zugeordneten Fläche auf der Lagekarte zurück auf diese Seite,
mit dem Bezirk hervorgehoben.

### Eine Standmeldung zurücknehmen

1. Am Bezirk „Verlauf“ aufklappen.
2. An der falschen Meldung „Zurücknehmen“ wählen und die Rückfrage „Meldung zurücknehmen?“
   bestätigen.

Die Meldung bleibt im Verlauf stehen, gekennzeichnet als zurückgenommen; es gilt wieder die
Meldung davor. Das lässt sich nicht umkehren.

## Hintergrund

### Wie gezählt wird

- Gemeldet wird immer die **Gesamtzahl**. Sie darf die Plangröße übersteigen.
- Ein Bezirk ohne Meldung zählt nicht als null: er steht auf „keine Meldung“. Hat kein aktiver
  Bezirk eine Meldung, steht bei „Evakuiert“ „—“.
- Stornierte und aufgehobene Bezirke zählen nicht in „Räumung in Zahlen“. Ohne aktiven Bezirk
  fehlt das Band ganz.
- Ein Zeitpunkt in der Zukunft wird abgelehnt. Eine Meldung mit einem älteren Zeitpunkt als die
  aktuelle wird als nachgetragen geführt („nachgetragen um …“), die aktuelle bleibt stehen.

### Lagebild

Sobald ein Bezirk angeordnet ist, trägt der Einsatz die Kennzahl „Evakuiert“ im Lagebild
([Lagebild](lagebild.md)); sie führt auf diese Seite. Wer das Modul „Evakuierung“ nicht sehen
darf, sieht dort keine Zahl.

### Stornieren

„Stornieren“ ist nur für Fehlanlagen gedacht und nicht umkehrbar. Der Dialog bietet stattdessen
„Räumung setzen“ an. Ein stornierter Bezirk verliert seine Flächen auf der Lagekarte; die Flächen
bleiben als nicht zugeordnete Bezirksflächen stehen. Der Nachweis im Einsatztagebuch bleibt.

### Einsatztagebuch

Das Anlegen eines Bezirks, eine neue Plangröße sowie „angeordnet“ und „aufgehoben“ stehen als
Entscheidung im Einsatztagebuch, „läuft“, „geräumt“ und Standmeldungen als Meldung, eine
Rücknahme als Berichtigung.

### Rechte

Anlegen und melden dürfen Einsatzleitung und Führungspersonal eines laufenden Einsatzes
([Rechte im Einsatz](rechte-im-einsatz.md)); ohne dieses Recht steht ein Hinweis über der Seite,
und die Knöpfe sind gesperrt. „Evakuierung“ und „Betreuung“ sind getrennte Module: jedes lässt sich
für sich ausblenden oder auf Rollen beschränken
([Einstellungen des Einsatzes und Module](einsatz-einstellungen.md)). Das gekoppelte Gerät einer
Betreuungsstelle sieht keine Bezirke.

Ein älterer Link auf einen Bezirk unter „Betreuung“ öffnet diese Seite mit dem Bezirk
hervorgehoben.

### Ohne Netz

Die Evakuierung bleibt ohne Netz lesbar. Standmeldungen lassen sich vormerken; sie tragen den
Zeitpunkt der Erfassung und gehen hinaus, sobald Netz da ist. Anlegen, Räumung und Stornieren gehen
nur mit Netz. Mehr in [Arbeiten ohne Netz](ohne-netz.md).
