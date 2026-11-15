# Design

## Context

Die Motivation steht in `proposal.md` unter „Why“, der abgestimmte Entwurf in
`docs/design/2026-11-15-alarmzone/`. Ausgangslage im Code (Pfade relativ zu `frontend/src/`):

- `alarm/useAlarmToasts.tsx` führt je Instanz einen Scope (Einträge, einzeln, gebündelt,
  OS-Meldungen) und zeichnet über antds `App.useApp().notification` (`duration: 0`, Budget
  `MAX_SICHTBARE_TOASTS = 3`, Sammeltoast). `onClose` am Toast und am Sammeltoast ruft
  `erledigt(…, true)` und quittiert damit; der Sprung im Sammeltoast quittiert über
  `alleSchliessen(true)` alles im Scope.
- Es gibt zwei Aufrufer, und je Tab lebt genau eine Instanz: `einsatz/AlarmZentrale.tsx`
  (`useAlarmToasts(einsatzId, quittiereNachNutzer)`, sitzt in der Kopfzelle `kopf-alarm` von
  `EinsatzLayout`) und `alarm/OrgBenachrichtigungen.tsx` (in `components/AppLayout.tsx`). Beide
  Layouts sind Geschwisterrouten. Die Unwetterwarnung kommt als Ereignis `lfh:unwetter-alarm` in
  die AlarmZentrale.
- antds Notification liegt mit `zIndexPopup` 2050 über Drawer und Modal (1000). Die Oberkante
  misst `components/alarmOben.ts` (`--notification-top` in `index.css`), `main.tsx` setzt
  `maxCount: 3`.
- Der klebende Rahmen (`components/rahmenOben.ts`): Quellen melden ihre Höhe, die Summe steht als
  `--lfh-rahmen-oben` am Dokument. `useRahmenObenStapel` gibt einer Quelle unter den übrigen ihr
  `top`, Vorbild ist `UebungsBand` (`components/instrument/Uebung.tsx`) auf `RAHMEN_EBENE` (100),
  also unter antds Overlays.
- Eingänge: `alarm/useEingangshinweis.tsx` (Regeln, Ton, Zurückhalten bei Fokus über
  `istEingabefeld` und `focusout`) und `alarm/Eingangsband.tsx` (Portal, `fixed` unten, weicht
  unteren Leisten über `useBandAbstand` aus, zIndex 999). Das ✕ am Band quittiert ebenfalls. Unter
  `useKopfBuendelt` öffnet `alarm/EingaengeKnopf.tsx` den Verlauf als Blatt von unten
  (`EINGAENGE_OEFFNEN_EVENT`).
- Gedächtnis je Tab: `alarm/benachrichtigungGedaechtnis.ts` (`quittiert`, `inArbeit`, `gezeigt`).
  Das Nachreichen in `alarm/useBenachrichtigungen.ts` filtert über `unbekannt`.
- Inhalt: `alarm/meldungInhalt.ts` holt Absender und Wortlaut einer Meldung mit Frist 1500 ms. Für
  die Erinnerung gibt es keinen Einzel-GET, nur `listeOffeneErinnerungen` unter dem Key
  `einsatzKeys.erinnerungenPhase(id, 'offen')`; `ErinnerungAnzeige` trägt `titel`.

## Goals / Non-Goals

**Goals:**

- Ein Speicher für Alarmeinträge, zwei Darstellungen: die Zone oben ab `md`, die Leiste unten
  unter `md`. Die Buchführung (Schlüssel, Doppelte, OS-Meldung, Quittieren) bleibt an einer Stelle.
- Ausblenden und Quittieren sind getrennte Wege mit getrennten Namen im Code.
- Die Zone steht im Fluss des Rahmens und braucht keine eigene Kantenmessung.

**Non-Goals:**

- Kein Server-Zustand „ausgeblendet“, kein Backend, keine Migration.
- Kein Gegenstand für Auftrag, Befehl, Gefahr, Chat und Nachforderung (LLH-1909), kein
  Entdoppeln der Erinnerung über Seiten hinweg (LLH-1908).
- Push und Service Worker bleiben unverändert (Spec `web-push`).

## Decisions

### D1 Speicher statt Notification: `useAlarmToasts` zeichnet nicht mehr selbst

`useAlarmToasts` behält seine Schnittstelle (`melde`, `entferne`, `entferneBenachrichtigung`,
`istEinzeln` wird zu `istSichtbar`, `zeigt`) und seinen Scope. Statt `notification.*` schreibt er
in einen Modul-Speicher (`alarm/alarmZoneSpeicher.ts`, `useSyncExternalStore`), den eine eigene
Darstellung liest. Weil je Tab genau eine Instanz lebt, genügt ein Speicher je Tab; der Scope
schreibt beim Abbau eine leere Liste. Die Darstellung `alarm/AlarmZone.tsx` steht im Rahmen:
in `EinsatzLayout` direkt nach `UebungsBand`, in `AppLayout` direkt nach dem `Header`.

- *Verworfen:* antd behalten und nur `zIndex` senken. Das verdeckt den Inhalt weiter und löst die
  Beschwerde am Fükw nicht.
- *Verworfen:* die Zone über ein Portal aus der AlarmZentrale zu zeichnen. Ein Portal braucht ein
  Ziel im Rahmen, und die Reihenfolge der Rahmenquellen (`useRahmenObenStapel`) hängt an der
  Position im DOM.

### D2 Die Zone ist eine Rahmenquelle unter dem Übungsband

`AlarmZone` meldet sich über `useRahmenObenStapel` und klebt mit `top: oben` auf `RAHMEN_EBENE`,
wie `UebungsBand`. Damit liegt sie unter Drawer, Modal und Dropdown. Klebende Tabellenköpfe und
der Fokusabstand (`scroll-padding-block-start`) rücken über `--lfh-rahmen-oben` von selbst darunter.
`alarmOben.ts`, `--notification-top` und `maxCount` entfallen, ebenso die Regel „Stehende Alarme
liegen unter der Bedienkante“ (LFH-1112) in `frontend/AGENTS.md`. Ihr Nachweis
`e2e/alarm-verdeckung.spec.ts` wird auf die Zone umgeschrieben: Kein Bedienelement des Inhalts
liegt unter ihr, Drawer und Dialog liegen über ihr. Unter `md` klebt der Kopf nicht; die Zone
klebt dort trotzdem (an `top` 0 bzw. unter der gestörten Betriebszeile). Im Einsatz steht sie
dort aber gar nicht (D5).

- *Verworfen:* eine feste, immer reservierte Zeile. Sie springt nie, kostet aber auf jeder Seite
  dauerhaft eine Zeile (Entscheidung Ruben, 15.11.2026).

### D3 Bündeln ab zwei, ohne Sammeltoast

Ein Eintrag ist eine Zeile. Ab zwei Einträgen steht eingeklappt der jüngste mit „+ n weitere“,
aufgeklappt eine Kopfzeile („3 Alarme“, je Art die Zahl über `sammelZeilen`) und darunter je
Eintrag eine Zeile mit eigenen Knöpfen. Aufklappen ist ein Zustand des Tabs, kein Quittieren. Die
Sprünge des Sammeltoasts (`ZIEL_SPRUENGE`) entfallen: jede Zeile hat ihr eigenes „Öffnen“. Damit
erledigt sich auch „der Sprung quittiert nur sein Ziel“, denn es gibt keinen Sammelsprung mehr.
`MAX_SICHTBARE_TOASTS`, `gebuendelt` und `sammelTitel` fallen weg oder wandern in die Darstellung.

- *Verworfen:* den Sammelsprung „Zu Aufträgen“ behalten und nur sein Ziel quittieren. In einer
  aufgeklappten Liste mit eigenem „Öffnen“ je Zeile ist er doppelt.

### D4 Ausblenden: eigenes Gedächtnis in sessionStorage

`benachrichtigungGedaechtnis.ts` bekommt die Menge `ausgeblendet` (Schlüssel des Eintrags, also
`b-<id>` bzw. `unwetter-…`), gespiegelt in `sessionStorage` unter einem eigenen Schlüssel mit
try/catch (Regel „Browserspeicher“ in `frontend/AGENTS.md`). Ein Schlüssel kommt hinein mit ✕ und
geht hinaus, sobald die Benachrichtigung quittiert ist. Wirkung:

- `melde` und das Nachreichen in `useBenachrichtigungen.ts` überspringen ausgeblendete Einträge
  (`unbekannt` prüft zusätzlich `ausgeblendet`).
- `erledigt(schluessel, art)` unterscheidet `'gelesen'` (quittiert), `'ausgeblendet'` (merkt
  sich, quittiert nicht) und `'weg'` (Abbau, Ersatz der Unwetterwarnung).
- Das ✕ am Eingangsband blendet die stehenden Einträge des Bandes aus; die Zahl am Knopf
  „Eingänge“ bleibt.
- Die OS-Meldung im Tab geht beim Ausblenden mit zu wie heute. Push-Meldungen anderer Geräte
  bleiben, sie schließen nur beim Quittieren.

- *Verworfen:* nur im Speicher merken. Nach dem Neuladen käme jeder ausgeblendete Alarm zurück.
- *Verworfen:* `ausgeblendet_at` am Server. Das gilt geräteübergreifend, berührt Backend und
  `frontend/AGENTS.md` „ein Gelesen-Zustand“ und war nicht gewünscht.

### D5 Am Handschirm eine Leiste; die Zone steht dort nicht

Unter `md` zeichnet die Zentrale im Einsatz statt des Eingangsbands die Leiste
`alarm/HandyLeiste.tsx` (48 px, Portal, `fixed` unten wie das Band, derselbe Ausweichweg
`useBandAbstand`). Sie nennt die Einträge, die das Band ab `md` zeigte (`bandAnzahl` aus
`useEingangshinweis`), und die Alarme aus dem Speicher (D1). Die Zahl am Knopf „Eingänge“ bleibt
die eine Zahl des Verlaufs; die Leiste zählt, was neu eingegangen und nicht ausgeblendet ist.
Stehen nur Eingänge an, trägt sie ✕ (Ausblenden wie am Band).
`AlarmZone` rendert im Einsatz unter `md` nichts. Ein Tipp sendet `EINGAENGE_OEFFNEN_EVENT`, und
das vorhandene Blatt von unten in `EingaengeKnopf` bekommt oben den Abschnitt „Alarm“ aus dem
Speicher (mit „Öffnen“, „Gelesen“, ✕) und heißt dann „Alarme und Eingänge“.

Einklappen: Ein neuer Hook `useFokusInEingabe` (auf Basis von `istEingabefeld` aus
`useEingangshinweis.tsx`, `focusin`/`focusout` am Dokument) klappt die Leiste ein. Steht ein Alarm
an, zeigt sie stattdessen eine Zeile mit dem jüngsten Alarm (Entscheidung Ruben, 15.11.2026).

Im Org-Rahmen gibt es weder Eingangsband noch Verlauf. Dort steht die Zone in jeder Breite.

- *Verworfen:* Alarm oben, Eingänge unten am Handy. Das sind zwei Leisten, und das Ticket
  verlangt eine.

### D6 Inhalt einer Erinnerung über die offene Liste

Ein Lader `alarm/erinnerungInhalt.ts` nach dem Muster von `meldungInhalt.ts`: Bei Bezug
`erinnerung` holt er über `queryClient.fetchQuery` mit dem Key
`einsatzKeys.erinnerungenPhase(id, 'offen')` (Frist `INHALT_FRIST_MS`) die offene Liste und nimmt
den `titel` der Erinnerung. Ein gefüllter Cache antwortet sofort. Titel im Hinweis: „Erinnerung
fällig: ‹Titel›“. Ohne Antwort in der Frist bleibt der Text des Servers. Der Verlauf
(`EingaengeKnopf`) nutzt dieselben Lader für Meldung und Erinnerung je sichtbarem Eintrag, damit
er dasselbe nennt wie Band und Alarm.

- *Verworfen:* ein Einzel-GET am Backend. Er brächte E3 und Codegen mit, während die offene Liste
  schon im Cache von Überblick und Erinnerungsseite liegt.
- *Verworfen:* den Titel in den Text der Benachrichtigung zu schreiben. Er ist ein Scrub-Wert
  (Spec „Benachrichtigungen ohne sensible Nutzlast“).

### D7 Wortlaut der Knöpfe

„Öffnen“ (springt und quittiert), „Gelesen“ (quittiert ohne Sprung), ✕ mit `aria-label`
„Ausblenden, ohne zu quittieren“. „Quittieren“ bleibt nach Spec `bedien-wortlaut` dem Empfang
einer Nachricht vorbehalten. Bei einem Alarm „Auftrag überfällig“ läse es sich wie die Quittung
des Auftrags (Entscheidung Ruben, 15.11.2026).

## Risks / Trade-offs

- [Die Zone verschiebt den Inhalt unter dem Cursor] → eine Zeile von 40 px, nur bei einem
  Alarm. Das ist eine benannte Ausnahme in `frontend/AGENTS.md` und in den CLS-Anforderungen;
  CLS-Messungen in e2e laufen ohne anstehenden Alarm.
- [Viele e2e-Specs greifen `.ant-notification-notice`] → ein eigener Greifer
  `[data-lfh="alarmzone"]` bzw. `[data-lfh="alarm-eintrag"]`. Die betroffenen Specs werden in
  derselben Aufgabe umgestellt. `abloesung-kontrast` räumt Alarme heute über ✕ ab und muss
  danach „Gelesen“ nutzen, sonst blendet es nur aus.
- [Ausgeblendetes geht über, weil `sessionStorage` je Tab gilt] → gewollt. Der Verlauf
  „Eingänge → Neu“ zeigt es weiter; im Org-Rahmen fehlt ein Verlauf, dort kommt ein
  ausgeblendeter Hinweis in einem neuen Tab wieder.
- [Ein großer Umbau von `useAlarmToasts` bricht das Budget-Verhalten der Zentralen] → die
  vorhandenen Tests in `benachrichtigungen.test.tsx`, `AlarmZentrale.test.tsx` und
  `OrgBenachrichtigungen.test.tsx` werden auf die Zone umgestellt, nicht gelöscht; ihre
  Aussagen (ein Schlüssel = ein Eintrag, Abbau ohne Quittung, OS-Meldung geht mit) bleiben.
- [Leiste und ETB-Erfassung konkurrieren um die Höhe am Handy] → 48 px, beim Tippen eingeklappt;
  `leisten-flaeche.spec.ts` prüft weiter zwei Einträge über der Erfassung.

## Migration Plan

Reiner Frontend-Wechsel ohne Datenmigration. Ein alter Tab, der neu lädt, hat leeres
`sessionStorage` für den neuen Schlüssel und zeigt alles Unquittierte wie bisher. Rückweg: Revert
des PRs.
