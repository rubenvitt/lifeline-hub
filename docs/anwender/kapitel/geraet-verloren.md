---
titel: Gerät verloren
gruppen: [alle, administration]
reihenfolge: 30
quellen: [src/auth/session.rs, src/routes/benutzer.rs, src/routes/geraet.rs, frontend/src/offline/geraetRaeumung.ts, frontend/src/offline/lagebildStart.ts]
---

## Sofort melden

Wer ein Gerät verliert, auf dem Lifeline Hub angemeldet war, meldet das **sofort** der
Einsatzleitung oder der Administration der Organisation, auch wenn das Gerät gesperrt war.

Der Grund: Eine Anmeldung gilt sieben Tage. Wer ein entsperrtes Gerät mit laufender Anmeldung
findet, arbeitet bis dahin mit allen Rechten der Person weiter, sieht die aktuelle Lage und kann
schreiben. Das ist das größere Risiko; die vorgehaltenen Daten auf dem Gerät kommen hinzu.

## Was die Person selbst tun kann

Wer an einem anderen Gerät noch angemeldet ist und mit Passwort anmeldet, ändert im Profil das
**eigene Passwort**. Das beendet alle anderen Anmeldungen dieses Kontos, also auch die auf dem
verlorenen Gerät.

## Was die Administration tun kann

- **Person deaktivieren** (Administration, „Benutzer“): beendet sofort jede Anmeldung der Person
  auf allen Geräten. Rückgängig mit „Reaktivieren“, sobald die Person wieder ein sicheres Gerät
  hat; Passwort und zweiter Faktor bleiben dabei unverändert.
- **Gekoppeltes Gerät widerrufen** (Einsatzleitung, Einstellungen des Einsatzes, „Geräte“): das
  Gerät verliert sofort jeden Zugriff, seine Einträge bleiben. Das Einsatztagebuch hält den
  Widerruf fest.

## Was danach auf dem verlorenen Gerät passiert

Sobald das Gerät das nächste Mal den Server erreicht, ist die Anmeldung ungültig. Das Gerät meldet
sich dann selbst ab und löscht das vorgehaltene Lagebild sowie zwischengespeicherte Orte und
Erfassungshilfen.

Zwei Grenzen bleiben:

- **Ohne Netz merkt das Gerät nichts.** Bis 24 Stunden nach seiner letzten Verbindung bleibt der
  vorgehaltene Stand dort lesbar (siehe [Arbeiten ohne Netz](ohne-netz.md)).
- **Vorgemerkte Einträge bleiben** auf dem Gerät, bis sie gesendet oder verworfen sind.

## Vorbeugen

- Jedes Gerät mit Lifeline Hub hat eine **Bildschirmsperre**, die sich nach kurzer Zeit von selbst
  einschaltet, und eine eingeschaltete **Geräteverschlüsselung**. Bei Telefonen und Tablets mit
  Code ist sie ab Werk an, bei Windows-Rechnern ohne BitLocker oft nicht.
- An gemeinsam genutzten Geräten nach jeder Schicht abmelden (siehe
  [Anmelden und Abmelden](anmelden-abmelden.md)).
