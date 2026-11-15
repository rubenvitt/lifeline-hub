# Design

## Context

Stand `alpha` f375fa4f (15.11.2026). Warum: proposal.md. Heute:

- `AppLayout` stellt über `Ebene1OrtKontext` Ort und Rückweg für die Seiten der Ebene 1 bereit.
  Die Logik steckt in der lokalen Funktion `useEbene1Ort` (`components/AppLayout.tsx`): sie liest
  den gemerkten Ort (`einsatz/letzterOrt.ts`, geschrieben von `EinsatzLayout`), holt die
  Einsatzliste (`globalKeys.einsaetze()`) und gibt „Zurück zu <Einsatz>“ nur bei aktivem Einsatz.
- `ebene1Seite` kennt `profil`, `benachrichtigungen`, `planungen`, `admin`, nicht `neuigkeiten`.
  Neuigkeiten hat deshalb weder Ortspfad noch Tab-Titel, und `NeuigkeitenPage` baut ihr h1 selbst
  statt über `AdminPage`, die den Rückweg anzeigt.
- `HilfePage` liegt außerhalb von `RequireAuth` und jedes Rahmens. Ihr Rückweg ist fest:
  Gerät → `/geraet`, angemeldet → `/einsaetze` („Zur App“), sonst `/login`. Die Herkunft kommt
  als History-State `von` aus dem `BenutzerMenu` und reist bei Kapitelwechseln mit; sie speist
  nur den Rückmeldeweg (LLH-1642 D5).
- `BenutzerMenu` steht in `AppLayout` und in `EinsatzLayout` (dort mit `funktion`) und navigiert
  für „Hilfe“ im selben Tab.
- Die Desktop-Hülle öffnet `window.open` auf die eigene Origin als Nebenfenster
  (`src-tauri/src/links.rs`, `entscheide_neues_fenster`).

## Goals / Non-Goals

**Goals:** eine Quelle für „Zurück zu <Einsatz>“, die Ebene 1 und Hilfe teilen; Hilfe neben dem
Einsatz am breiten Schirm, ohne den Rückmeldeweg zu verlieren.

**Non-Goals:**
- Rail und Einsatzname auf diesen Seiten zeigen (Seiten im Einsatzrahmen, verworfen).
- Den Rückweg der Verwaltung und der Planungen ändern: sie laufen schon über denselben Weg.
- Hilfe aus dem Gerätemenü (`geraet/GeraeteMenue.tsx`) und von der Anmeldeseite: dort bleibt sie
  im selben Tab, ihr Rückweg bleibt „Zum Gerät“ bzw. „Zur Anmeldung“.
- Den Namen der Anforderung „Rückweg von Profil und Verwaltung“ ändern: ein RENAMED neben einem
  MODIFIED lohnt das Risiko beim Archivieren nicht; die Beschreibung nennt alle Seiten.

## Decisions

### D1 Ein geteilter Hook für den Rückweg

Neu `einsatz/einsatzRueckweg.ts` mit `useEinsatzRueckweg(benutzerId, aktiv)`: liest den
gemerkten Ort je Adresse neu (wie bisher, die Person kann in einem anderen Tab im Einsatz sein),
holt die Einsatzliste nur, wenn ein Ort gemerkt ist, und liefert `{ label, pfad }` nur für einen
aktiven, gelisteten Einsatz, sonst `undefined`. `AppLayout` ruft ihn mit `aktiv` = „Seite hat
einen Ort“, `HilfePage` mit `aktiv` = „Person angemeldet und kein Gerät“.

Je Adresse neu gelesen wird der Ort nur auf den Seiten der Ebene 1. Die Hilfe liest ihn einmal je
Besuch (`isJeBesuchFest`, Review B5, Entscheidung 15.11.2026): arbeitet die Person im ersten Tab
weiter, änderte sonst der nächste Kapitelwechsel das Ziel des Knopfs still, und die Anforderung
„Rückweg aus der Hilfe“ verlangt, dass ein Kapitelwechsel den Rückweg nicht ändert. Im Hilfe-Tab
neben dem Einsatz führt der Rückweg auch diesen Tab in den Einsatz; mehrere Tabs sind vorgesehen
(LFH-387), „Hilfe schließen“ wurde am 15.11.2026 verworfen.

Verworfen: den Rückweg in der Hilfe aus `state.von` bilden. Der Pfad dort ist genauer nur in
einem Fall (gesperrtes Modul, das `EinsatzLayout` nicht merkt), fehlt aber bei jedem Direktaufruf
und im neuen Tab, und der Name des Einsatzes müsste ohnehin aus der Liste kommen. Eine Quelle für
alle Seiten hält die Bedingung („aktiv und sichtbar“) an einer Stelle.

### D2 Neuigkeiten als Seite der Ebene 1

`ebene1Seite` bekommt `neuigkeiten` → `{ titel: ['Neuigkeiten'], ort: ['Neuigkeiten'] }`.
`NeuigkeitenPage` rendert über `AdminPage titel="Neuigkeiten"`; der Inhalt bleibt, die Breite von
900 px hält ein Wrapper wie bisher (`AdminPage` kennt nur `voll` und `schmal`). Nebenwirkung:
der Tab heißt „Neuigkeiten · lifeline-hub“ statt „lifeline-hub“, wie es die Anforderung „Tab-Titel
nennt Seite und Einsatz“ für Ebene 1 ohnehin verlangt.

### D3 Rückwege der Hilfe

Reihenfolge: Gerät „Zum Gerät“ → nicht angemeldet „Zur Anmeldung“ → Rückweg aus D1 „Zurück zu
<Einsatz>“ → „Zu den Einsätzen“. Solange die Sitzung lädt, gilt wie bisher der Zweig nach
`benutzer`; solange die Einsatzliste lädt, steht „Zu den Einsätzen“ und wechselt mit den Daten.
Der Knopf hält seine Breite nicht fest: er steht rechts im Kopf, nichts rückt hinter ihm nach.

### D4 Hilfe im neuen Tab: wann

`EinsatzLayout` gibt `BenutzerMenu` die neue Prop `hilfeDaneben` (der Rahmen weiß, dass er der
Einsatz ist; ein Pfadvergleich im Menü wäre eine zweite Wahrheit). Das Menü öffnet die Hilfe
neben dem Einsatz, wenn `hilfeDaneben` gesetzt ist, `abBreite('lg')` gilt und der Zeiger fein ist
(`!istBeruehrung`), sonst navigiert es wie bisher. Unter `lg` liegen Handy und Tablet hochkant,
mit grobem Zeiger das Führungs-Tablet quer (1024–1280 px, über `lg`); auf beiden verdeckte ein
zweiter Tab den Einsatz, statt daneben zu stehen. Die Breite allein trennt das Tablet nicht vom
Fükw (Review B1); die Fragen stellt `useViewport` (`useViewport.guard.test.ts`). Ein 2-in-1 mit
Tastatur meldet einen feinen Zeiger und bekommt den neuen Tab wie ein Laptop.

Verworfen: jedes Öffnen in einem neuen Tab (Handy und installierte App verlören den Rückweg);
Strg+Klick als einziger Weg (unauffindbar, das Menü ist kein Link).

### D5 Hilfe im neuen Tab: wie, und die Herkunft

`window.open(hilfeAdresse, '_blank', 'noopener')`. Ein neuer Tab erbt den History-State nicht;
die Herkunft reist deshalb als Suchparameter `von` (`hilfePfad({ von })` in
`routing/deeplinks.ts`). `HilfePage` übernimmt beim ersten Rendern einen gültigen `von`
(beginnt mit `/`, wie `parseHerkunft`) in den History-State und ersetzt die Adresse ohne ihn
(`navigate(…, { replace: true, state: { von } })`), alle übrigen Parameter (`gruppe`) bleiben.
So bleibt die Herkunft nicht in Lesezeichen und kopierten Links, und der Rückmeldeweg liest wie
bisher nur `state.von`. Die Herkunft verlässt die Installation nicht: das Formular bekommt
weiter nur das Routenmuster.

Liefert `window.open` nichts, weil ein Blocker greift (bei einem Klick im Menü nicht zu erwarten,
mit `noopener` aber auch im Erfolgsfall `null`), lässt sich Erfolg nicht unterscheiden; deshalb
kein Rückfall auf dieselbe Seite, der sonst die Hilfe doppelt öffnete.

Verworfen: `sessionStorage` als Träger (mit `noopener` nicht kopiert) und `postMessage` (braucht
den Opener, den `noopener` gerade kappt).

## Risks / Trade-offs

- [Blockierter neuer Tab: nichts passiert] → Klick im Menü ist eine Nutzergeste; Browser lassen
  sie durch. Ein Test prüft den Aufruf mit Ziel und Merkmalen.
- [Installierte PWA am Desktop öffnet einen Browser-Tab statt eines App-Fensters] → hinnehmbar:
  der Einsatz bleibt im App-Fenster, das ist der Zweck.
- [Zwei Tabs mit derselben Sitzung] → Sitzungen über mehrere Tabs sind vorgesehen (LFH-387,
  `frontend/src/auth/AGENTS.md`); die Hilfe schreibt nichts.
- [Neuigkeiten ändert ihren Kopf sichtbar (Ortspfad, Seitenkopf-Linie)] → beabsichtigt, gleich wie
  Profil und Benachrichtigungen; e2e `neuigkeiten.spec.ts` und `dichte-laden.spec.ts` prüfen nur
  Adresse und Ladung, nicht den Kopf.
