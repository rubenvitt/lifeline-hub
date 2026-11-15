# Proposal

## Why

Alarme stehen heute als antd-Notifications oben rechts (`duration: 0`, bis zu drei einzeln). Sie
liegen über Seitenaktionen („Auftrag erteilen“, „Person erfassen“), über dem Navigations-Drawer am
Handy und über Dialogen. Wer einen Alarm nur wegräumt, um an den Knopf darunter zu kommen,
quittiert ihn mit dem Schließkreuz. Einige Hinweise sagen nicht, worum es geht („Erinnerung
fällig“). Am Handy belegen Alarm und Eingangsband zusammen rund 360 px, bei offener Tastatur
bleibt vom ETB nichts. So steht es in der UI/UX-Analyse vom 12.11.2026 (LLH-1714, Thema 2,
LLH-1716 mit LLH-1735 bis LLH-1738).

## What Changes

- **Alarmzone statt Toast-Stapel** (LLH-1735): Alarme, Org-Hinweise und die Unwetterwarnung
  stehen in einer eigenen Zone im Rahmen, direkt unter dem Kopf und einem Übungsband. Sie klebt
  wie die übrigen Rahmenbänder, liegt unter Drawer und Dialogen und schiebt den Inhalt um eine
  Zeile nach unten, statt ihn zu verdecken. Ein Alarm braucht eine Zeile. Ab zwei Alarmen bündelt
  die Zone sie zu „+ n weitere“, aufklappbar mit Zähler und den Arten. antds `notification` und
  die Kantenmessung `alarmOben.ts` entfallen. **BREAKING** für e2e-Greifer
  `.ant-notification-notice`.
- **Ausblenden ist nicht Quittieren** (LLH-1736): ✕ blendet einen Alarm und das Eingangsband nur
  für diesen Tab aus (bis der Tab schließt). Quittiert wird mit „Öffnen“ (springt) und dem neuen
  Knopf „Gelesen“ (bleibt). Ein Sprung aus der gebündelten Zone quittiert nur die Alarme seines
  Ziels.
- **Jeder Hinweis nennt sein „Was“** (LLH-1737): Eine fällige Erinnerung nennt ihren Titel. Der
  Client holt ihn aus der Liste der offenen Erinnerungen, wie er den Inhalt einer Meldung heute
  über die Meldung holt. Der Verlauf „Eingänge“ nennt bei Meldungen Absender und Wortlaut wie
  Alarm und Band. Für weitere Arten (Auftrag, Befehl, Gefahr, Chat) folgt LLH-1909, das Entdoppeln
  der Erinnerung folgt in LLH-1908.
- **Am Handy eine Leiste** (LLH-1738): Unter `md` tragen Alarm und Eingänge eine gemeinsame
  Leiste von 48 px unten („1 Alarm · 3 Eingänge ›“). Ein Tipp öffnet das Blatt „Alarme und
  Eingänge“ von unten. Bei Fokus in einem Eingabefeld klappt die Leiste ein; steht ein Alarm an,
  bleibt sie als eine Zeile stehen.
- Die Regel „Live-Updates springen nicht unter dem Cursor“ bekommt eine benannte Ausnahme für die
  Alarmzone. `frontend/AGENTS.md` (Rahmen, Layout und Live), die Anwenderdoku und das Design
  System ziehen mit.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `benachrichtigungen`: Stufen und Budget sprechen von der Alarmzone statt von Toasts, und ab zwei
  Alarmen wird gebündelt. Schließen blendet aus, Quittieren läuft über „Öffnen“ oder „Gelesen“.
  Das Eingangsband ist am Handschirm eine Leiste, die beim Tippen einklappt. Die fällige
  Erinnerung nennt ihren Titel, das Nachreichen achtet Ausgeblendetes.
- `einsatztauglichkeit-layout`: Das Erscheinen und Gehen der Alarmzone zählt nicht als
  Layoutsprung beim Laden. Die Alarmzone ist ein klebender Aufbau des Rahmens im Sinne von „Kein
  Fokusziel vollständig verdeckt“.

## Impact

- Frontend `alarm/` (`useAlarmToasts.tsx` wird ein Speicher mit eigener Darstellung `AlarmZone`,
  `useEingangshinweis.tsx`, `Eingangsband.tsx`, `EingaengeKnopf.tsx`, `useBenachrichtigungen.ts`,
  neu ein Inhalts-Lader für Erinnerungen, ein Gedächtnis für Ausgeblendetes),
  `einsatz/AlarmZentrale.tsx`, `einsatz/EinsatzLayout.tsx`, `components/AppLayout.tsx`,
  `components/alarmOben.ts` (entfällt), `index.css` (`--notification-top` entfällt), `main.tsx`
  (`maxCount`).
- Tests: Unit-Tests unter `alarm/` und `einsatz/AlarmZentrale.test.tsx`; e2e
  `alarm-verdeckung`, `eingangsband-ausweichen`, `eingangshinweis`, `sofortmeldung-hinweis`,
  `abloesung-kontrast`.
- Doku: `frontend/AGENTS.md`, `docs/anwender/kapitel/einsatz-oberflaeche.md` (dazu
  `meldungen.md`, `ohne-netz.md`, `erinnerungen.md`), Design System neu erzeugen (Bausteine
  Eingänge, neu Alarmzone).
- Kein Backend, keine Migration, keine API-Änderung. Entwurf:
  `docs/design/2026-11-15-alarmzone/`.
