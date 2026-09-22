-- LFH-614: Funkrufname als Stammfeld der disponierten Einheit. Bisher stand ein Rufname nur
-- an den Fahrzeugmitgliedern (einsatz_fahrzeug.snap_funkrufname); das Meldebild leitete ihn
-- nur ab, solange die Einheit GENAU ein Fahrzeug hat, und verlor ihn mit dem zweiten.
-- Nullable TEXT, kein Default, kein CHECK — Voll-Ersatz-Semantik wie bemerkung (Muster
-- 0086_einheit_funk). Bewusst KEIN Unique-Index: Eindeutigkeit je Einsatz wäre eine neue
-- Invariante samt 409-Pfad, die niemand verlangt hat. Kein Personenbezug → RETAIN in
-- schwaerze_einsatz.
ALTER TABLE einsatz_einheit ADD COLUMN funkrufname TEXT;
