-- Heraufstufung Chat-Nachricht → Auftrag (LFH-101). Rückverweis analog zur
-- ETB-Heraufstufung (chat_nachricht.etb_eintrag_id, 0043): NULL = nicht zu einem
-- Auftrag heraufgestuft. Die ETB-Anordnung des Auftrags entsteht modul-lokal im
-- Auftrag-Anlegen (Pattern B); hier nur der direkte Rückverweis auf den Auftrag.
ALTER TABLE chat_nachricht ADD COLUMN auftrag_id INTEGER REFERENCES auftrag(id);
