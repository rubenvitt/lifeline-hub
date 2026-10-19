# Kennzahl und Kennzahlenband

Quelle: `frontend/src/components/instrument/Kennzahl.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.

Kennzahl und Kennzahlenband — „Zahl führt".

Eine Zelle: Augenbraue · Zahl Mono 500 in drei Stufen (22 / 32 / 40 aus `schriftskala`) ·
optionale Einheit Mono 12 `schwach` · Notiz 11 `gedaempft` · optionaler Aufgliederungsbalken.
Das Band setzt n Zellen ins FUGENRASTER: `gap: 1px` auf `linie`, jede Zelle auf `flaeche`.
Die Fuge bleibt in jeder Dichtestufe 1 px; den Abstand klickbarer Zellen hält der Einzug
(siehe „KLICKBAR“).

── DATENZUSTÄNDE (wie im Lage-Dashboard, LFH-331 · B3) ────────────────────────────

`laden` → „····" mit `aria-busy`, Notiz „wird abgerufen". `fehler` → „?" mit
`title="Stand unbekannt"`, Notiz „Stand unbekannt". Die Strings pinnen die Tests von
`pages/lage-dashboard/LageDashboardPage.tsx`. Eine NULL ist ein Wert, kein Zustand — die drei
Formen sehen verschieden aus. Der Ton gilt nur im Zustand `daten`: ein „?" in Alarmrot
behauptete eine Lage, die niemand kennt.

── TON UND ZWEITER KANAL ──────────────────────────────────────────────────────────

`achtung`/`alarm` färben die Zahl UND setzen eine abgestufte Innenkante (3 bzw. 6 px,
`inset`-Schatten, null Layout): die beiden Eskalationsstufen unterscheiden sich auch ohne
Farbe, und die Zeile springt nicht.

`normal`/`bedien` (etwa „frei", „am Einsatzort" im Meldebild) färben nur die Zahl, ohne
Kante: ein Zustand ohne Handlungsbedarf bekommt keine. Der zweite Kanal ist dort das Wort in
Augenbraue und Notiz.

KONTRAST DER ZAHL (WCAG, gegen `flaeche` als Grund von `.lfh-kennzahl`; Boden Tag ≥ 7 : 1,
Nacht ≥ 5 : 1):

| Ton     | Rolle der Zahl | Tag (auf #ffffff) | Nacht (auf #0f1215) |
|---------|----------------|-------------------|---------------------|
| normal  | normalText     | 9,18              | 10,92               |
| bedien  | bedienText     | 9,51              |  9,95               |
| achtung | achtungText    | 9,22              | 11,75               |
| alarm   | alarmText      | 8,96              |  6,77               |

`neutral` steht in `text` (Tag 18,47). Die Füllfarben selbst tragen den Tagesboden als Text
nicht, deshalb die `…Text`-Rollen.

── NOTIZHÖHE (LFH-629, LFH-691) ──────────────────────────────────────────────────

Eine Notiz, deren Länge sich mit der Lage ändert, ließe das Band wachsen und schrumpfen und
alles darunter springen (Prüfliste Kriterium 12). Das Band fordert deshalb Platz an, gesetzt in
`sprache.css` vom ersten Bild an: unter `md` mit `notizZeilenSchmal` einen Boden (LFH-629), ab
`md` mit `notizZeilen` Boden UND Deckel (LFH-691). Eine längere Notiz endet dort mit „…“; der
volle Text bleibt im DOM, also im zugänglichen Namen, und steht im Zustand `daten` im `title`.
Die tragende Aussage einer Notiz steht deshalb vorn. Herleitung:
`openspec/changes/archive/2026-10-01-lfh-691-kennzahl-notiz-feste-hoehe/design.md`.

HANDSCHUH UNTER `md` (LFH-883): die Polsterung `paddingLG` (44 px) lässt auf 390 px eine
Textspalte von rund 94 px (kompakt 146, komfortabel 126). Darin bricht eine Augenbraue wie
„Schäden offen“ zweizeilig um und die Pegel-Notiz dreizeilig, die Platzhalter aber tragen eine
Zeile Augenbraue und „wird abgerufen“: die Reihen wuchsen mit den Daten um 13 bzw. 16 px. In
dieser Stufe hält das Band deshalb zwei Zeilen Augenbraue und eine Notizzeile mehr als
`notizZeilenSchmal` (`sprache.css`, an `[data-dichte]`, damit der Platz vom ersten Bild an steht).

── STATUSPUNKT ────────────────────────────────────────────────────────────────────

`punkt` setzt ein 8-px-Quadrat in der Tonfarbe VOR die Augenbraue — die Kachel benennt damit
eine STUFE (S1 … S6), keine Bewertung der Zahl; deshalb getrennt von `ton`. Dekoration
(`aria-hidden`), der zweite Kanal ist die Augenbraue. Nur im Zustand `daten` getönt, sonst
neutral an seinem Platz.

── KLICKBAR ────────────────────────────────────────────────────────────────────────

Mit `ziel` trägt die Zelle einen `<Link>` — ein handgebautes Bedienziel mit den ZWEI
Angaben aus LFH-365. Auch im Zustand `laden` bleibt sie ein Link: das Ziel existiert ohne
Zahl.

ABSTAND ZWISCHEN ZIELEN (LFH-630, Bedien-Leitlinie Kriterium 2): im Fugenraster stünden zwei
Links nur 1 px auseinander, die Leitlinie verlangt in `komfortabel` ≥ 8 px und in `handschuh`
≥ 16 px. Die Fuge bleibt deshalb 1 px, und der Link rückt INNERHALB seiner Rasterzelle um
`kennzahlZielEinzug` (0 / 4 / 8 px) von jedem Rand ab: zwischen zwei Treffflächen liegen
Zellfläche, Fuge, Zellfläche. Die Polsterung des Links sinkt um denselben Betrag, Zahl und
Notiz stehen also wie ohne Ziel. Die Zelle (`data-lfh="kennzahl-zelle"`) trägt den Grund, der
Link Inhalt, Treffhöhe und die Prüfanker (`data-lfh="kennzahl"`, `data-ton`), eine Auflage
nach dem Link die Eskalationskante (`data-lfh="kennzahl-kante"`, siehe
`kennzahlZielStil`). Hover und Fokus liegen als `.lfh-kennzahl__ziel` in `sprache.css` auf dem Link:
die Tönung zeigt, wo ein Tippen wirkt, der Rand bleibt still. Herleitung und verworfene
Wege (breitere Fuge, Kacheln):
`openspec/changes/archive/2026-10-01-lfh-630-kennzahlenband-handschuh-abstand/design.md`.
