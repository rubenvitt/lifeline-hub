# Speicherleiste

Speicher-Leiste am unteren Rand einer Sektion — sticky, mit Trennlinie und eigenem Grund.

**Sticky ist die halbe Zusicherung, „im `<form>`" die andere.** Ein Knopf im Kopf-Slot von
`EinsatzSeite` stünde AUSSERHALB des `<form>` und könnte nichts übermitteln; hier trägt er
`htmlType="submit"`, und Enter sendet über die eingebaute Formularübermittlung (Erfassungs-Norm
B4/LFH-332). Sticky, weil er sonst bei vielen Feldern aus dem Bild scrollt, während man das
letzte ausfüllt.

Kein `<Space>`: auf den Formularseiten steht genau EIN Knopf, kein `danger`-Nachbar. Eine
Sitzung, die man abbrechen kann (Bearbeiten-Modus einer Detailseite, LLH-1101), trägt
„Speichern“ und „Abbrechen“: mit `hasAbbrechen` wird die Leiste eine umbrechende Reihe mit dem
Abstand `padding` (11/18/26 px), derselben Stufe wie der Fuß der Erfassungs-Hülle — die
Leitlinie verlangt ≥ 8 px mit Maus, ≥ 16 px mit Touch (`frontend/AGENTS.md`, „Farbe und
Zeichen“). Ohne die Option bleibt die Leiste, wie sie war.

Quelle: `frontend/src/components/speicherLeiste.ts` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
