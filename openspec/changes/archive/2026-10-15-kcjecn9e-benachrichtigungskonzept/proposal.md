# Proposal

## Why

Die App meldet sich heute nur bei vier Anlässen von selbst: Sofortmeldung, fällige Erinnerung
oder überfälliger Auftrag, Ablösung und Unwetter. Alles andere frischt nur still die Listen auf.
Wer einen Auftrag bekommt, im Verteiler eines Befehls steht oder auf eine Nachforderung wartet,
muss deshalb selbst nachsehen (Rückmeldung von Ruben, 13.10.2026, LLH-1187). Zugleich melden die
bestehenden Alarme an alle mit Modulrecht, auch die Erinnerung „an S4“ und die eigene
Sofortmeldung beim Erfasser. Gebraucht wird ein Gesamtkonzept: welches Ereignis wen wie laut
erreicht.

## What Changes

- **Drei Stufen** für jede Benachrichtigung: *Alarm* (lauter Ton, Toast, OS-Meldung im
  Hintergrund), *Hinweis* (dezenter Ton, Toast, OS-Meldung im Hintergrund) und *still* (nur
  Zähler oder Marke).
- **Adressierung durch den Server, je Nutzer.** Der Server bestimmt die Empfänger einer
  Benachrichtigung (an mich, an meine Funktion, an alle mit Modulrecht) und schickt nur ihnen
  einen eigenen Benachrichtigungs-Event. Meine Funktion ergibt sich aus der Stab-Besetzung,
  ersatzweise aus der Funktion meiner Einsatz-Mitgliedschaft. Die Nutzlast bleibt ohne
  sensible Inhalte.
- **Eigene Aktionen benachrichtigen den Auslöser nie**, auch nicht beim Erfassen einer
  Sofortmeldung.
- **Matrix Ereignis × Empfänger × Stufe** als Spec. Bestehende Alarme werden teils neu
  adressiert: ein überfälliger Auftrag alarmiert nur Auftraggeber und Empfänger, eine fällige
  Erinnerung erreicht ihre Empfängerfunktion (sonst den Ersteller) als Hinweis. Neu melden:
  Auftrag erteilt, Auftrag quittiert oder erledigt, Befehl oder Lagebericht im Verteiler,
  Meldung an mich, Lagebesprechung steht an oder ist überfällig, Status einer Nachforderung,
  neue Gefahr, Einheit oder Fahrzeug wieder verfügbar, Chat-Erwähnung, Aufnahme in einen
  Einsatz, neuer Einsatz.
- **Meldungen bekommen eine Empfängerfunktion** als strukturiertes Feld, so wie Aufträge sie schon
  kennen. Das freie Empfängerfeld bleibt daneben bestehen.
- **Chat-Erwähnung** (`@Name` oder `@Funktion`) als neue Fähigkeit des Chats.
- **Einstellbarkeit je Nutzer** auf dem Server: Kategorien der Stufe *Hinweis* lassen sich
  einzeln abschalten, die Stufe *Alarm* nicht.
- **Zustellung Stufe 1:** Toast und Ton im offenen Tab, OS-Meldung im Hintergrund-Tab (wie
  heute), in der Desktop-App eine native Meldung, deren Klick das Fenster nach vorn holt. Benachrichtigungen,
  die während eines Neuabgleichs verloren gingen, reicht der Server nach. Web Push bei
  geschlossenem Tab ist ausdrücklich eine spätere Stufe.
- **Gekoppelte Geräte bleiben still.** Das behebt nebenbei den Ton ohne Anzeige bei einer
  Sofortmeldung. Der Lagemonitor hebt eine neue offene Sofortmeldung und eine neue Person der
  Sichtungskategorie I sichtbar hervor, ohne Ton und ohne Personenbezug.

## Capabilities

### New Capabilities

- `benachrichtigungen`: Stufen, Adressierung, Ausschluss eigener Aktionen, Matrix Ereignis ×
  Empfänger × Stufe, Bündelung, Einstellbarkeit je Nutzer, Zustellwege und Nachreichen.

### Modified Capabilities

- `lagemonitor`: neue Anforderung zur sichtbaren Hervorhebung neuer Sofortmeldungen und neuer
  Personen der Sichtungskategorie I, ohne Ton und ohne Personenbezug.

- `kraefte-abloesung`: der Hinweis zur Vorwarnung und Fälligkeit kommt als Benachrichtigung statt
  über das Live-Ereignis `abloesung`, das nur noch die Liste auffrischt.

`live-abgleich` und `lage-wetter-pegel` behalten ihre Anforderungen: Unwetter bleibt, wie es ist,
und die Sofortmeldung wirkt weiter ohne Sammelfenster.

## Impact

- **Backend:** neuer Benachrichtigungs-Event im Einsatz-Strom und im Org-Strom, mit
  Empfängerauflösung je Nutzer (Stab-Besetzung, Mitgliedschaft, Auftragsempfänger, Verteiler);
  Auslöser an allen beteiligten Schreibwegen. Der Erinnerungs-Scheduler übernimmt die Termine
  der Lagebesprechung. Neue Migrationen: Meldungsempfänger, Chat-Erwähnungen,
  Benachrichtigungs-Einstellungen. Neue Schlüssel in `benutzer_einstellungen` oder eine eigene
  Tabelle (siehe design.md).
- **Frontend:** `AlarmZentrale` wird zur Benachrichtigungszentrale für alle Arten, mit
  gemeinsamem Budget; Einstellungen im Benutzermenü; Empfängerfeld der Meldung;
  `@`-Vervollständigung im Chat; Geräte-Layout ohne Ton; Hervorhebung im Lagemonitor.
- **Desktop-Hülle:** Befehl für eine native Meldung und Fensterfokus, Eintrag in
  `SERVER_RECHTE` und im AppManifest.
- **Wire-Vertrag:** neues `LiveEvent` und `OrgLiveEvent` samt Typ-Codegen und Vertragstests.
- **Doku:** Anwenderkapitel `einsatz-oberflaeche`, `meldungen`, `erinnerungen`, `auftraege`,
  `chat`, `lagemonitor`, `geraet-bedienen` und ein Abschnitt zu den Einstellungen.
