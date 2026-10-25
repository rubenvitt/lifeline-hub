# Design

## Context

`theme/schriften.ts` meldet neun Schnitte über die FontFace-API an (`registerSchriften`, aufgerufen
in `main.tsx` vor dem Rendern), alle mit `display: 'swap'`. Was der Bildschirm braucht, lädt der
Browser bei der ersten Layoutberechnung. Der Rest kommt im Leerlauf nach `load`, weil der Druck ihn
setzt (LFH-1108). Das Rendern wartet heute auf nichts: Das erste Bild steht in der Ersatzschrift,
sobald ein Schnitt nicht schon decodiert vorliegt. Bei `swap` ist die Blockzeit des Browsers
praktisch null.

Die Dateien kommen aus dem Bundle (`assets/`, gehasht). Das Backend liefert sie mit
`public, max-age=31536000, immutable` aus (`src/static_files.rs`). Im Precache des Service Workers
liegen sie nicht (Vorgabe `globPatterns` von vite-plugin-pwa: js, css, html). Nach dem ersten
Aufruf kommen sie also aus dem HTTP-Cache, beim Kaltstart vom Server im selben Netz.

Warum das an der Kopfleiste springt: siehe proposal.md, „Why“.

## Goals / Non-Goals

**Goals:**
- Das erste Bild steht in den Bildschirm-Schnitten, wenn sie innerhalb der Frist laden.
- Die Frist ist gedeckelt. Eine langsame oder fehlende Schrift hält die App nie länger als 300 ms auf.
- Die Anmeldung aller Schnitte, der Leerlauf-Nachlader und der Druckweg bleiben wie sie sind.

**Non-Goals:**
- Schriften in den Precache des Service Workers aufnehmen. Das ist eine eigene Frage (Offline,
  Update-Größe) und für diese Wartezeit nicht nötig.
- Eine metrisch angeglichene Ersatzschrift (`size-adjust`). Verworfen, siehe D3.
- Der Sprung im Seitenkopf des Meldebilds in `handschuh` (LLH-1463). Das ist ein anderer Inhalt,
  der nachgeladen wird, kein Schriftwechsel.

## Decisions

### D1: Warten vor dem ersten `render`, nicht CSS-`font-display`

`registerSchriften` gibt ein Promise zurück. Es erfüllt sich, sobald alle Bildschirm-Schnitte
geladen sind oder 300 ms vergangen sind, je nachdem, was zuerst eintritt. Die Bildschirm-Schnitte
lädt es dafür sofort aktiv (`FontFace.load()`), statt auf die Layoutberechnung zu warten.
`main.tsx` ruft `createRoot(...).render(...)` erst in dessen `then`. Ein Fehlschlag eines Schnitts
zählt als „fertig“, damit er die Frist nicht ausschöpft.

Alternativen:
- `display: 'block'` oder `'optional'`: Die Blockzeit des Browsers ist nicht steuerbar (bis zu 3 s
  bei `block`). `optional` ließe beim Kaltstart die ganze Sitzung in der Ersatzschrift stehen.
  Beides widerspricht der Abwägung aus LFH-352.
- Top-Level-`await` in `main.tsx`: Das Bauziel ist ES2020, `then` reicht und hält den Rest des
  Moduls (Service-Worker-Registrierung, `QueryClient`) unverzögert.

### D2: Bildschirm-Schnitte als Eigenschaft des Eintrags

`SCHRIFTSCHNITTE` bekommt je Eintrag eine Kennzeichnung, ob der Schnitt vor dem ersten Bild
gebraucht wird: Archivo 400/500/600, Archivo Narrow 600, JetBrains Mono 400/500, nach Rubens
Entscheidung. Die Liste der Schnitte bleibt die eine Quelle. Kein zweites Array, das bei einem neuen
Schnitt auseinanderläuft.

Archivo 700 (Zahlplaketten, einzelne Hervorhebungen) und JetBrains Mono 600 bleiben im Leerlauf.
Sie tragen keine Zeile, deren Breite den Umbruch des Rahmens entscheidet. Einsatzzeichen Sans
gehört zu den Zeichen und braucht ohnehin die Lagekarte oder Skizze.

### D3: Keine metrisch angeglichene Ersatzschrift

Eine `size-adjust`-Ersatzschrift über `local(...)` hängt an der Systemschrift: Segoe UI, SF Pro,
DejaVu und Inter haben verschiedene Breiten. Ein Wert passt für ein System und verfehlt die anderen.
Sie verkleinert das Sprungband, schließt es aber nicht. Dazu müsste sie als `FontFace` angemeldet
werden (CSS-`@font-face` ist gesperrt, `schriften.test.ts`).

### D4: Frist 300 ms als Konstante neben den Schnitten

Die Frist steht als benannte Konstante in `schriften.ts`, mit Begründung. 300 ms liegen unter der
Schwelle, ab der ein leerer Schirm als Warten wahrgenommen wird, und weit unter der Sekunde aus
LFH-352. Aus dem HTTP-Cache dauern die Schnitte wenige Millisekunden.

### D5: Nachweis im Browser über den Zeitpunkt des ersten Inhalts

Die e2e-Messung prüft nicht nur die CLS-Summe, die von den Metriken der Ersatzschrift abhängt (lokal
Inter, ohne Sprung). Sie prüft den Mechanismus: Ein Init-Skript beobachtet `#root`. Hängt dort der
erste Knoten an, notiert es `document.fonts.check(...)` für die Bildschirm-Schnitte. Die
Schriftabrufe sind dabei per `page.route` um 150 ms verzögert, damit ohne Warten sicher die
Ersatzschrift stünde (Mutationsprobe). Die Kantenfälle bleiben als CLS-Messung und laufen in der CI
mit DejaVu als Ersatzschrift.

## Risks / Trade-offs

- [Langsamer Kaltstart über ein schwaches Netz] → Die Frist deckelt das Warten bei 300 ms. Danach
  springt der Rahmen wie bisher, wenn die Schrift später kommt. Bekannt und hingenommen, siehe
  Non-Goals (Precache).
- [CI unter Last braucht mehr als 300 ms für die Schriften] → Der Kantenfall würde wieder flattern.
  Gegenmittel: Der Mechanismus-Nachweis (D5) misst mit fester Verzögerung unter der Frist. Wird die
  Kante in der CI trotzdem rot, ist das ein Befund über die Frist und kein Grund, den Test zu lockern.
- [Vitest und jsdom kennen `FontFace` nicht] → Die Tests stubben `FontFace` wie bisher
  (`schriften.test.ts`), die Wartefunktion bekommt Uhr und Menge injiziert. `main.tsx` testet die
  e2e-Messung.
