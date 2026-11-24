-- LLH-2074: Meldende Seite (ELW) — seit wann das Push-Relais den Hub sperrt, aus seiner
-- Meldeantwort (`MeldenAntwort.ios_push_gesperrt_seit`, UTC); NULL = nicht gesperrt.
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_ios_push_gesperrt_seit TEXT;
