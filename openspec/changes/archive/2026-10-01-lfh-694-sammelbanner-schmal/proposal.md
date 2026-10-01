# Proposal

## Why

Ablösung und Verpflegung stellen das Sammelbanner für fremde Neuzugänge in die Werkzeugzeile
neben die Segmentleiste. So verschiebt sein Erscheinen keine Karte. Auf dem Handschirm (390 px)
trägt das nicht: Der Text des Banners schrumpft auf 0 px, und der Knopf „anzeigen“ läuft über
den Rand. Die Messung vom 01.10.2026 zeigt das in beiden Modulen, nicht nur in der Verpflegung
(Befund S1 der LFH-634-Prüfliste). Die Ablösung zeigt im Handschuh-Betrieb 0 px Text. Die
Verpflegung läuft dort 59 px über (`scrollWidth` 449), in `komfortabel` zeigt sie 0 px Text.
Gate 1 sieht das nicht, weil dort kein Banner steht.

## What Changes

- Unter `md` zeigt das Sammelbanner eine **Kurzform**: Pfeilikone und „1 neu“ (bzw.
  „umgeordnet“, wenn nur die Reihenfolge wartet). Das ganze Banner ist dann **ein** Knopf, der
  wie „anzeigen“ freigibt. Die vollständige Mitteilung bleibt im Statusbereich für Hilfstechnik
  und im zugänglichen Namen des Knopfes.
- Die Verpflegung kürzt unter `md` ihre Segmentbeschriftung „laufend & anstehend (n)“ auf
  „aktuell (n)“. Die Ablösung braucht das nicht, ihre Beschriftungen sind schon kurz.
- Ab `md` bleibt alles wie bisher: der volle Satz neben der Segmentleiste, rechts „anzeigen“.
- Die Werkzeugzeile bleibt eine Zeile und ändert ihre Höhe beim Eintreffen des Banners weiter
  nicht. Es kommt keine reservierte Zusatzzeile.
- Gate 1 bekommt einen Fall mit stehendem Banner bei 390 px in allen drei Dichtestufen für
  beide Module. Er prüft Überlauf, den Knopf im Fenster, die ungekürzte Kurzform, die
  Zeilenhöhe und die Lage der obersten Karte.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderung „Das Sammelbanner einer Werkzeugzeile bleibt
  auf dem Handschirm bedienbar“ (390 × 844, alle drei Dichtestufen).

## Impact

- Frontend: `components/instrument/Sammelbanner.tsx` (Kurzform als Prop),
  `pages/AbloesungPage.tsx`, `pages/VerpflegungPage.tsx` (Werkzeugzeile, Kurztext,
  Segmentbeschriftung unter `md`), dazu Vitest neben diesen Dateien.
- e2e: `e2e/gate1-ueberlauf.spec.ts` (neuer Fall). `e2e/abloesung-zufluss.spec.ts` klickt
  weiter über den Namen „anzeigen“, der in der Kurzform erhalten bleibt.
- Kein Backend, keine API, keine Migration. Andere Sammelbanner (ETB, Lage-Dashboard,
  FMS-Tableau, Infotelefon) stehen in eigener Zeile und bleiben unberührt.
