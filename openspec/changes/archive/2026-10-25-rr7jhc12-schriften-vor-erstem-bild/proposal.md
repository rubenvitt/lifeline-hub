# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/rr7jhc12u4jrmvkcfyis0ndx (LLH-1272)

## Why

Der App-Rahmen springt beim Laden, wenn der Viewport an der Umbruchkante der Kopfleiste liegt
(`flexWrap`, `einsatz/EinsatzLayout.tsx`). Die erste Ursache, das Etikett des Benutzermenüs, das
nach dem Einsatz-Abruf breiter wurde, behebt PR #1006 schon. Die neue Messung
`e2e/rahmen-cls-dichte.spec.ts` fand in der CI eine **zweite**: den Schriftwechsel. Die Schriften
sind über die FontFace-API mit `display: 'swap'` angemeldet (`theme/schriften.ts`). Das erste Bild
steht deshalb in der Systemschrift, auf dem Ubuntu-Runner DejaVu Sans, deutlich breiter als Archivo.
Danach kommt Archivo, und der Kopf wechselt von zwei Zeilen auf eine. Rail, Panel und Inhalt
springen 52 px (`komfortabel`) bzw. 72 px (`handschuh`), Seiten-CLS 0,58–0,60.

Lokal nachgestellt mit DejaVu als `sans-serif`/`system-ui` (fontconfig) und um 800 ms verzögerten
Schriftabrufen: Sprung bei 1344–1360 px (0,59), ohne Verzögerung keiner. Auf einem Gerät mit
anderer Systemschrift (Windows: Segoe UI) liegt das Sprungband an einer anderen Breite, verschwindet
aber nicht. Der Schriftwechsel verschiebt außerdem jeden Text auf jeder Seite.

## What Changes

- Vor dem ersten Rendern wartet die App kurz auf die **Bildschirm-Schnitte**: Archivo 400/500/600,
  Archivo Narrow 600, JetBrains Mono 400/500. Sie wartet **höchstens 300 ms**, danach rendert sie
  in jedem Fall, und ein später geladener Schnitt tauscht wie bisher (`swap`). Entscheidung Ruben,
  24.10.2026.
- Die übrigen Schnitte (Archivo 700, JetBrains Mono 600, Einsatzzeichen Sans) lädt die App wie
  bisher im Leerlauf nach dem Laden der Seite.
- Ein Schnitt, der scheitert, hält das Rendern nicht auf. Der Text steht dann in der Ersatzschrift,
  wie heute.
- Die bewusste Abwägung aus LFH-352 („lieber sofort in der Systemschrift lesbar als eine Sekunde
  lang gar nichts“) bleibt im Kern: Die Wartezeit ist gedeckelt und liegt weit unter einer Sekunde.

## Capabilities

### New Capabilities

### Modified Capabilities
- `einsatztauglichkeit-layout`: neue Anforderung, dass der App-Rahmen beim Laden nicht springt,
  weder durch nachgeladene Kopfinhalte noch durch den Schriftwechsel. Dazu gehört, dass das erste
  Bild in den Bildschirm-Schnitten steht, sofern sie innerhalb der Frist laden.

## Impact

- Frontend: `theme/schriften.ts` (Anmeldung, Wartefunktion, Kennzeichnung der Bildschirm-Schnitte),
  `main.tsx` (Rendern nach der Wartefunktion), `theme/schriften.test.ts`.
- e2e: `e2e/rahmen-cls-dichte.spec.ts` (Nachweis, dass das erste Bild in Archivo steht, auch bei
  verzögerten Schriften; die Kantenfälle werden in der CI wieder grün).
- Kein Backend, keine Migration, keine Typen. Das Design System erzeugt aus `theme/schriften.ts`
  (`frontend/AGENTS.md`); neu erzeugen, falls der Generator die Änderung sieht.
- Erstes Bild beim Kaltstart bis zu 300 ms später; mit Schriften im HTTP-Cache (`immutable`,
  `src/static_files.rs`) wenige Millisekunden.
