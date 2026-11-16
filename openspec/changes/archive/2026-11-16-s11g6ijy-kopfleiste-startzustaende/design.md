# Design

## Context

Siehe proposal.md, „Why“. Der Stand im Code:

- `offline/useOfflineQueueZaehler.ts` startet mit `LEER` und lädt die Zähler über
  `queueZaehlerLaden` aus der IndexedDB `lifeline-offline`, gedrosselt auf einen Ladevorgang je
  `ZAEHLER_DROSSEL_MS` (LFH-939, D5). Die Kopfleiste (`SyncAnzeige`) und die Betriebszeile
  (`LiveStatusBanner`) rufen ihn ohne Einsatz, also über alle Einsätze der Person.
- `alarm/desktopAlarm.ts`, `desktopPermission()`: Auf Android gibt es den
  `Notification`-Konstruktor nicht, eine Meldung geht nur über den Service Worker. Bis der auf
  die Nachfrage geantwortet hat (`DESKTOP_ZUSTAND_EVENT`), meldet die Funktion `unsupported` —
  auch dann, wenn `Notification.permission` schon `denied` sagt.
- `AlarmZentrale` liest den Zustand im ersten Render (`useState(desktopPermission())`) und beim
  Ereignis neu.
- Browserspeicher nur über `lib/sichererSpeicher` (`frontend/AGENTS.md`, „Browserspeicher“);
  jeder Ort steht mit Entscheidung in `GERAETESPEICHER` (`offline/AGENTS.md`, „Gerätedaten beim
  Abmelden“), der Guard `geraetRaeumung.guard.test.ts` wird sonst rot.

## Goals / Non-Goals

**Goals:**

- Beide Störungen stehen im ersten Bild, ohne dass ein Platz freigehalten wird.
- Der Merker verrät nach einem Ausgang nichts über die vorige Person.

**Non-Goals:**

- Der Wechsel durch einen echten Abgleich (vorgemerkte Einträge gehen raus, „WARTET“ verschwindet)
  bleibt eine Änderung der Kopfbreite: dann hat sich der Zustand geändert, nicht das Wissen.
- Ton und Verbindung beim Start: unverändert (LLH-1726).
- Kein Merker für den Einsatz-Scope des Hooks; ihn ruft keine Anzeige im Rahmen.

## Decisions

### D1 — Android: `denied` gilt ohne Service Worker

`desktopPermission()` meldet `denied`, sobald `Notification.permission` es sagt, vor der Prüfung
des Zustellwegs. Der Service Worker entscheidet nur, ob eine erteilte oder offene Berechtigung
einen Weg hat; eine verweigerte bleibt verweigert, gleich auf welchem Weg. Die Reihenfolge in der
Funktion: Hülle → API fehlt → `denied` → Zustellweg → `Notification.permission`.

Folge: Ohne steuernden Worker (Entwicklungsserver, allererster Aufruf, älterer Worker ohne
Alarm-Teil) zeigt eine verweigerte Berechtigung „blockiert“ statt „nicht verfügbar“. Das stimmt:
die Person muss sie in den Browsereinstellungen freigeben, bevor irgendein Weg trägt. Die
Testmeldung auf der Seite „Benachrichtigungen“ meldet dann ebenfalls „blockiert“.

*Verworfen:* die zuletzt bestätigte Android-Berechtigung im Browserspeicher merken (Vorschlag der
Aufgabe). Mehr Code, und der Merker veraltet, wenn die Berechtigung außerhalb der App geändert
wird; der Browser kennt den Wert ohnehin synchron. Abgestimmt am 16.11.2026.

### D2 — Warteschlange: zuletzt gelesener Zähler als Merker

Ein Merker im `localStorage` über `sichererSpeicher`, **ein Platz** unter einem festen Schlüssel
(`lfh:queue-zaehler`), Wert `{ benutzer_id, ausstehend, abgelehnt, nicht_zugeordnet }` als JSON.
Nur Zahlen und die Kennung, keine Inhalte.

- **Lesen:** Der Hook nimmt im globalen Scope (ohne `einsatzId`) als Startwert den Merker, wenn
  `benutzer_id` passt; sonst `LEER`. Ein unlesbarer oder fremder Wert gilt als `LEER`, nie als
  Fehler im Render (`sicherLesen` wirft nicht, das JSON wird geprüft).
- **Schreiben:** nach jeder Ladung im globalen Scope, auch wenn sie `LEER` ergibt — sonst bliebe
  eine abgebaute Warteschlange als Zahl stehen. Andere Tabs teilen den Speicher, also gilt der
  zuletzt gelesene Stand des Geräts.
- **Ein Platz statt je Benutzer:** ein Wechsel der Person überschreibt ihn; mehr als die zuletzt
  aktive Person braucht das erste Bild nicht.

*Verworfen:* den Kopf erst zeigen, wenn IndexedDB geantwortet hat (verzögert jedes erste Bild für
einen seltenen Fall); die Zähler beim Start vorab in den Modulspeicher laden (die Person steht
erst mit `/api/auth/me` fest, im selben Takt rendert der Rahmen — kein verlässlicher Vorsprung).

### D3 — Räumung: `jeder-ausgang`

Eintrag in `GERAETESPEICHER` mit `jeder-ausgang`; `geraetRaeumen` entfernt den Schlüssel bei
Abmelden und Sitzungsende. Die Warteschlange selbst bleibt (Beweissicherung), nach der nächsten
Anmeldung liest der Hook sie neu und schreibt den Merker wieder. Preis: Wer sich mit offener
Warteschlange abmeldet, sieht beim ersten Laden danach den Sprung noch einmal. Abgestimmt am
16.11.2026. Ein Benutzerwechsel ohne Ausgang ist durch die Kennung im Merker gedeckt.

### D4 — Nachweis

- Unit: Hook startet mit dem Merker (erstes Render, vor jeder IndexedDB-Antwort), ignoriert einen
  fremden oder kaputten Merker, schreibt nach dem Laden auch `LEER`; `desktopPermission` auf
  Android ohne bzw. mit unbestätigtem Worker bei `denied`; Alarmzentrale zeigt das Wort im ersten
  Render; `geraetRaeumen` entfernt den Merker.
- e2e `rahmen-cls-dichte.spec.ts`: zwei vorgemerkte Einträge in `lifeline-offline` anlegen
  (über die App ohne Netz oder direkt im Store), den Abgleich während der Messung zurückhalten
  (die Anfragen der Wiedergabe per `page.route` nicht beantworten), die Kante mit „WARTET 2“
  suchen und dort neu laden; Grenze wie im bestehenden Kantenfall (`HAUS_GRENZE`).

## Risks / Trade-offs

- [Merker veraltet, wenn die Warteschlange ohne geladenen Hook schrumpft] → Der Hook hängt in
  jeder Seite mit Kopfleiste; ein Abgleich läuft nur angemeldet. Schlimmstenfalls springt der
  Kopf einmal in die Gegenrichtung, wie heute in der einen.
- [Kurz falsche Zahl im ersten Bild] → Die Warteschlange bestätigt binnen Millisekunden; die Zahl
  ist die zuletzt gesehene des Geräts, keine erfundene.
- [Testmeldung auf Android ohne Worker sagt „blockiert“] → gewollt (D1).
- [Gerät ohne Browserspeicher (gehärteter Rechner, `sichererSpeicher` liefert `null`)] → kein
  Merker, der Sprung bleibt dort wie bisher; die Spec nimmt diesen Fall wie das erste Laden nach
  einer Anmeldung (D3) ausdrücklich aus (Befund aus dem Review vor dem PR).
