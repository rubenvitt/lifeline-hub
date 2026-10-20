# Sammelbanner

Sammelbanner — „12 neue Meldungen" statt eingeschobener Zeilen (Neuentwurf S4;
Bedien-Leitlinie Festlegung 6: Live-Updates springen nicht unter dem Cursor, CLS ≤ 0,1,
WCAG 3.2.5).

Grund `bannerGrund`, Kante `bannerLinie`, Pfeilicon in `bedien`, Text 12 in
`bedienText` (Kontrast Tag 7,19 · Nacht 9,71), rechts die Aktion Mono in `bedien`.
Blau, nicht Rot: ein neuer Eintrag ist eine Bedienaufforderung, keine Gefahr.

`role="status"` — höflich angesagt, nie unterbrechend. Das Banner ist die EINE Meldung
je Liste; eine zweite Aktualisierung ändert seinen Text, sie stapelt kein zweites.

Die Aktion ist ein antd-`Button type="link"`: er erbt `controlHeight` vom
`ConfigProvider` und schuldet damit nicht die zwei Angaben eines handgebauten
Bedienziels (LFH-365). Das Icon steht in einer `aria-hidden`-Hülle — antds Icons
bringen ein eigenes englisches `aria-label` mit.

KURZFORM für den Handschirm (LFH-694,
`openspec/changes/archive/2026-10-01-lfh-694-sammelbanner-schmal/`): steht das Banner in einer
Werkzeugzeile neben einer Segmentleiste, bleibt ihm bei 390 px zu wenig Breite für Satz UND
Knopf (gemessen: Text 0 px, bis 59 px Überlauf). Mit `kurz` (und einer
`aktion`) wird das GANZE Banner ein Knopf: Icon plus „1 neu" (`sammelbannerKurz`),
eine Polsterung statt zwei, die ganze Fläche Trefffläche. Der Name lautet „1 neu anzeigen"
(sichtbarer Text im Namen, WCAG 2.5.3); der volle Satz bleibt visuell verborgen im
Statusbereich und wird wie bisher angesagt. Ob die Kurzform gilt, entscheidet der Aufrufer
(`useViewport().istSchmal`), nicht dieser Baustein.

Quelle: `frontend/src/components/instrument/Sammelbanner.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
