# Design

## Context

- **Kleben heute** (LFH-952, `components/rahmenOben.ts`): Ab `md` klebt der Kopf (`RAHMEN_KLEBT`,
  `top: 0`) in `EinsatzLayout` und `AppLayout`, und nur ab `md` meldet er seine Höhe als Quelle.
  Unter `md` klebt allein die Betriebszeile (`live/LiveStatusBanner.tsx`, Bedingung
  `klebend && !mittel && stoerung`); sie steht in `App.tsx` vor jedem Rahmen. Das Übungsband
  (LLH-1725) klebt in jeder Breite als letzte Quelle; `useRahmenObenStapel` gibt ihm als `top` die
  Summe aller Quellen ohne seine eigene.
- **Handy-Kopf im Einsatz heute** (`einsatz/EinsatzLayout.tsx`, unter `md`): links Griff „Menü“,
  Statuspunkt, Wechsler; rechts in `KopfRechts` Eingänge und Alarmzentrale (gebündelt,
  `useKopfBuendelt`), `SyncAnzeige kompakt`, Suchauslöser, Benutzermenü. Die Uhr steht erst ab
  `md`. Die rechte Gruppe bricht als Ganzes in eine zweite Zeile um.
- **Alarmzentrale gebündelt** (`einsatz/AlarmZentrale.tsx`): am Handy steht der Zustand immer im
  Wort („Ton bereit“), am Tablet mit Finger nur bei Störung (LFH-637, LFH-950).
- **App-Rahmen am Handy** (`components/AppLayout.tsx`): Bildmarke, Wortmarke, „Verwaltung“ und
  „Planungen“ als Symbol, rechts Sync (nur bei Störung), Suche, Benutzermenü; zweizeilig. Einen
  Drawer gibt es dort nicht.
- **Drawer im Einsatz**: unter `lg` (`!breit`), Titel „Navigation“, Inhalt `ModulAkkordeon`.
- **Ortspfad**: `EinsatzSeite` nimmt ihn als `breadcrumb` (rund 60 Aufrufer, fast alle antds
  `Breadcrumb` mit `items`, die ersten zwei Einträge „Einsätze“ und der Einsatz). `ortspfadAbMd`
  blendet ihn unter `md` per CSS aus (Infotelefon und drei weitere Seiten). Detailseiten führen
  über ihn zur Liste zurück, die Personenansicht auf die Zeilenmarke (`frontend/AGENTS.md`,
  Deeplinks).
- **Nachbarn**: LLH-1726 (Kopfleiste entlasten) und LLH-1727 (Rahmen fest, Inhalt rollt) arbeiten
  gleichzeitig in denselben Dateien, ab `md`.

## Goals / Non-Goals

**Goals:**

- Am Handy bleibt der Kopf im Bild: Menü, Einsatz, Alarm, Verbindung, Uhr in einer Zeile.
- Ein Stapelmodell für alles, was oben klebt, in DOM-Reihenfolge, ohne gerechnete Höhen.
- Unter `md` weniger Rahmen über dem Inhalt: kein zweizeiliger Kopf, kein Ortspfad im Einsatz.

**Non-Goals:**

- Nichts ab `md` am Kopf (Aufbau, Wortlaut der Daueranzeigen, Suche im Kopf): LLH-1726.
- Kein innerer Scrollbereich, kein festes Rahmenraster: LLH-1727.
- Keine Änderung am Inhalt des Benutzermenüs oder der Sprungpalette.
- Breite und Beschreibungen des Handy-Drawers: LLH-1734.

## Decisions

### D1 Der Kopf klebt in jeder Breite, in beiden Rahmen

`EinsatzLayout` und `AppLayout` setzen den Klebestil immer und melden den Kopf immer als Quelle.
Die Stufe „ab `md`“ entfällt für den Kopf; gestuft bleibt nur die Rail (ab `lg`).
*Alternative:* `position: fixed` mit Platzhalter. Verworfen: `sticky` ist schon das Muster ab
`md`, braucht keinen Platzhalter und folgt dem Umbruch von selbst.

### D2 Stapel in DOM-Reihenfolge statt „Summe ohne mich“

Mit dem klebenden Kopf am Handy kleben dort bis zu drei Quellen übereinander: Betriebszeile
(Störung), Kopf, Übungsband. „Summe ohne mich“ (`useRahmenObenStapel`) trägt nur, solange genau
ein Element unter den übrigen hängt; zwei solche zählten sich gegenseitig mit. Jede Quelle meldet
deshalb einen **Rang** (Betriebszeile 0, Kopf 1, Band 2), und ihr `top` ist die Summe der
Quellen mit kleinerem Rang. `RAHMEN_OBEN_VAR` bleibt die Gesamtsumme, alles andere hängt sich wie
bisher darunter. Die Ränge stehen als Konstanten in `rahmenOben.ts`; der Guard
`rahmenOben.guard.test.ts` bleibt gültig. Ab `md` bleibt die Betriebszeile unverändert
nicht klebend; dort trägt die SYNC-Zelle im Kopf die Störung im Wort.
*Alternativen:* (a) Die Betriebszeile klebt am Handy nicht mehr, das Symbol im Kopf trägt die
Störung. Verworfen: Am Handy steht die Verbindung nur als Symbol, „Offline“ wäre nicht mehr
benannt, und das Szenario „Offline auf dem Handy“ fiele. (b) Die Betriebszeile in den Kopf
verschieben. Verworfen: Sie hat Aktionen („Anträge abgelehnt“, „Alte Offline-Daten ansehen“)
und gehört allen Routen, nicht dem Kopf.

### D3 Eine Zeile am Handy: was bleibt, was in den Drawer geht

Unter `md` trägt der Einsatzkopf: Griff „Menü“ · Statuspunkt · Wechsler · Alarmzentrale
(gebündelt) · Verbindung (`SyncAnzeige kompakt`) · Uhr. Die Uhr bekommt dort die schmale
Zellpolsterung des Handy-Kopfs (`paddingXS`), sonst wie ab `md` (Mono 14/500, Browserzeit).
Suchauslöser und Benutzermenü stehen unter `md` nicht im Kopf, sondern im Drawer „Navigation“:

- **„Suchen“** als erster Eintrag über dem Modulakkordeon, mit Lupe; Tippen schließt den Drawer
  und öffnet die Sprungpalette (derselbe Weg wie der Suchauslöser im Kopf).
- **Benutzermenü** im Fuß des Drawers, derselbe Baustein `BenutzerMenu` mit der Einsatzfunktion;
  das Menü öffnet wie im Kopf.

Zwischen `md` und `lg` bleiben beide im Kopf, der Drawer trägt sie dann nicht (keine
Doppelung).
*Alternative:* ein Dreipunkt-Überlauf im Kopf. Verworfen: ein weiteres Ziel in der knappen Zeile,
und der Drawer ist der Ort, den man am Handy ohnehin für alles Weitere öffnet.

### D4 Alarmzentrale am Handy: Ruhe als Symbol, Störung im Wort

Die gebündelte Alarmzentrale nennt am Handy den Zustand nur noch bei Störung im Wort („Ton
blockiert“, „Ton stumm“, gestörte Benachrichtigung), wie schon am Tablet mit Finger. Im
Ruhezustand steht die Glocke allein; ihr zugänglicher Name nennt den Zustand weiter. Das hält
die Regel „blockiert oder stumm nie nur als Symbol“ und gibt dem Einsatznamen die Breite von
„Ton bereit“ zurück. Es löst nebenbei den Befund aus LLH-1726, dass die Zählmarke am Handy das
„T“ überdeckt.
*Alternative:* das Wort behalten und den Namen härter kürzen. Verworfen: Gemessen bliebe dem
Namen in `handschuh` weniger als seine Mindest-Trefffläche (siehe Risiken).

### D5 App-Rahmen am Handy: Wortmarke weg, Rest bleibt

`AppLayout` hat keinen Drawer; Suche und Benutzermenü bleiben dort im Kopf. Unter `md` entfällt
die Wortmarke „lifeline-hub“ (die Bildmarke bleibt), die Uhr kommt dazu. Damit ist der Kopf in
`kompakt` und `komfortabel` einzeilig; in `handschuh` darf er umbrechen und klebt dann
zweizeilig.

### D6 Ortspfad im Einsatz unter `md`: nur der Rückweg

Ein boolescher Rahmenkontext „im Einsatzrahmen“ (gesetzt von `EinsatzLayout`, auch solange der
Einsatz lädt) gibt dem Ortspfad eine Klasse. Unter `md` blendet CSS dann alle Einträge aus bis
auf den letzten verlinkten ab dem dritten Eintrag (also unterhalb von „Einsätze“ und dem Einsatz);
er erscheint als „‹ <Eintrag>“. Seiten ohne solchen Eintrag zeigen keinen Ortspfad. Kein Aufrufer
ändert sich. `ortspfadAbMd` bleibt und heißt weiter: unter `md` gar nichts.
*Alternativen:* (a) alles weg. Verworfen: Detailseiten verlören den Weg zur Liste samt
Zeilenmarke. (b) Die Einträge aus `Breadcrumb.items` in JS lesen. Verworfen: hängt an der Form
jedes Aufrufers, einige reichen eigene Knoten durch.

### D7 Regeltext

`frontend/AGENTS.md`, „Stehenbleiben, gestuft“: Der Kopf klebt in jeder Breite; die Rail ab
`lg`; die Betriebszeile klebt unter `md` bei Störung über dem Kopf. Der Absatz „Wer oben klebt“
nennt die Ränge. Die Herleitung verweist auf diese Change.

## Risks / Trade-offs

- **Konflikte mit LLH-1726/1727** in `EinsatzLayout.tsx`, `Kopfleiste.tsx` und `AlarmZentrale.tsx`.
  Diese Change ändert nur Zweige unter `md` und den Stapel; wer später mergt, gleicht an. D4
  nimmt einen Teil von LLH-1726 vorweg; das steht als Kommentar an LLH-1726.
- **Platz, gemessen am 15.11.2026** (Demo-Einsatz, 390 × 844, Stand `alpha` 8f18cf3d). Heute ist
  der Einsatzkopf zweizeilig: 105 px in `kompakt` und `komfortabel`, 145 px in `handschuh`. Rechts
  stehen Alarm 90–139 px, Sync 23–31, Suche 48–72, Benutzermenü 32–72. Ohne Suche und
  Benutzermenü, mit Glocke statt „Ton bereit“ und mit Uhr (etwa 61 px) bleiben dem Wechsler etwa
  205 / 179 / 121 px; die Mindest-Trefffläche in `handschuh` ist 72 px
  (`e2e/kopfzeile-schmal.spec.ts`). Der Kopf wird einzeilig: 52 bzw. 72 px. Steht „Ton
  blockiert“ im Wort (etwa 80 px mehr), reicht es in `handschuh` nicht mehr: dann bricht die
  rechte Gruppe als Ganzes um, wie heute. Eine Störung darf den Kopf dort höher machen.
- **App-Rahmen in `handschuh`:** gemessen heute zweizeilig (145 px), mit Uhr und ohne Wortmarke
  rechnerisch weiter zweizeilig (links etwa 240, rechts etwa 235 px). Er klebt dann zweizeilig.
  Die Einsatzliste wird kurz gerollt; die Uhr dort wiegt das auf.
- **Höhe am Handy, gestört und in einer Übung:** Betriebszeile, Kopf und Band zusammen nehmen
  oben über 110 px. Das ist eine Störungslage und bewusst laut.
- **e2e:** Mehrere Specs öffnen das Benutzermenü am Handy über den Kopf; sie öffnen künftig erst
  die Navigation. Die Gegenprobe „unter `md` rollt der Kopf“ in `rahmen-stehen-bleiben.spec.ts`
  kehrt sich um.
- **CSS `:has()`** für D6: in allen Zielbrowsern vorhanden; jsdom wertet es nicht aus, deshalb
  belegt der Rückweg ein e2e-Test, nicht Vitest.
