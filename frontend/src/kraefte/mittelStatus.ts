import type { EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import { statusKategorie, type StatusDarstellung } from '../theme/statusFarben';

/**
 * Statusanzeige eines disponierten Mittels (Fahrzeug, Personal) als `StatusDarstellung` —
 * EINE Stelle für die Fachseiten (`pages/FahrzeugePage.tsx`, `pages/PersonalPage.tsx`) und
 * die Lese-Vorschau der Sprungpalette (`kraefte/FahrzeugVorschau.tsx`,
 * `kraefte/PersonalVorschau.tsx`, LFH-664).
 *
 * Bis LFH-664 lagen beide Funktionen als `statusDarstellung` in ihren Seiten. Eine zweite
 * Leserin (die Vorschau) hätte sie sonst kopieren oder die ganze Seite importieren müssen —
 * und zwei Kopien derselben Statusregel laufen still auseinander.
 *
 * Die Mandantenfarbe (`status_farbe`) steckt bewusst NICHT in der Darstellung: sie geht beim
 * Aufrufer an `StatusTag farbe=…`, das dann die Rand-Form erzwingt (siehe unten).
 *
 * Nicht zu verwechseln mit dem Typ `MittelStatus` in `kraefte/meldebildRaster.ts` — das ist
 * die Chip-Beschreibung des Meldebilds (Ton + Wort + FMS-Code), keine `StatusDarstellung`.
 */

/**
 * Statusanzeige eines disponierten Fahrzeugs — und zugleich die GRENZE des
 * Statusfarb-Vertrags (LFH-328/A2, Spec §1.3).
 *
 * Die Anzeige hat zwei Achsen, und nur eine davon kann der Vertrag tragen:
 *
 * 1. **DB-Achse** — `status_farbe` ist mandantengepflegter Freitext aus den
 *    Stammdaten-Tabs. Das Backend (`src/routes/fahrzeug_status.rs`) trimmt ihn und
 *    prüft sonst NICHTS: kein Enum, kein Hex-Format. Ein getypter `Record` kann das
 *    nicht einfangen. Diese Achse bleibt deshalb unangetastet — wer sie „aufräumt",
 *    nimmt dem Mandanten seine gepflegte Farbe weg. (Dass sie gegen die A0-Rollen
 *    validiert werden sollte, ist ein eigener Befund, Spec §5 Nr. 1.)
 * 2. **Fallback-Achse** — früher `KATEGORIE_FALLBACK`, byte-identisch in der Fahrzeug- und
 *    der Personalseite dupliziert. Sie kommt jetzt aus `statusKategorie`.
 *
 * ABWEICHUNG VOM PLANWORTLAUT, bewusst: der Plan sagt „`status_farbe ?? …` bleibt
 * stehen", gemeint als „die DB-Achse bleibt". Aus dem `??` einen Zweig zu machen
 * erhält genau das — und vermeidet den Fehler, den `StatusTag` selbst dokumentiert:
 * antds `color`-Prop rendert einen NICHT-Preset-Wert als Vollfläche mit erzwungen
 * weißem Text. Die Rollenfarbe dort hineinzureichen (`rollenFarbe(...)` liefert Hex,
 * nie einen Preset-Namen) hätte aus jedem Fallback-Tag — dem Normalfall, solange kein
 * Mandant eine Farbe pflegt — eine gefüllte Fläche gemacht, im Dunkelmodus mit weißer
 * Schrift auf aufgehelltem Rot.
 *
 * ── DIE DB-ACHSE VERLIERT MIT LFH-339 · C4 IHRE FLÄCHE, NICHT IHRE FARBE ──────────
 *
 * A2 liess die DB-Achse auf antds `color` stehen; die Sorge dort war ausdrücklich der
 * VERLUST der gepflegten Farbe („wer sie aufräumt, nimmt dem Mandanten seine Farbe
 * weg"), nicht die Fläche als solche. Die Zielform-Spec §4b entscheidet die Fläche
 * inzwischen eigens und mit derselben Vertragsgrenze als Begründung: `status_farbe` ist
 * ungeprüfter Freitext, Kontrast (WCAG 1.4.11) ist dort NICHT zugesichert — auf einer
 * grossen Fläche mit erzwungen weissem Text ist das eine Lesbarkeitszusage, die niemand
 * geben kann; auf Rand und Text trägt dieselbe Farbe keine Textlesbarkeit.
 *
 * Der Zweig fällt deshalb: die Mandantenfarbe geht über `StatusTag`s `farbe`-Prop auf
 * Rand und Text und bleibt damit erhalten. Das ist KEIN Zurückdrehen von A2, sondern
 * dessen Sorge eingelöst — und es hält die beiden Zweige der Seite bei EINER
 * Darstellung: der Auslöser aus `components/StatusWahl.tsx` trägt dasselbe Etikett wie
 * diese Anzeige, und zwei Formen für denselben Status wären ein Unterschied ohne
 * Bedeutung.
 */
export function fahrzeugStatusDarstellung(ef: EinsatzFahrzeug): StatusDarstellung {
  // Ohne Status bleibt es beim neutralen Wortlaut des Bestands — ein „—" sagt in einer
  // Statusspalte weniger, und die Zeile muss von hier aus einen Status BEKOMMEN können.
  if (!ef.status_label || !ef.status_kategorie) return { rolle: 'neutral', label: 'kein Status' };
  return { ...statusKategorie[ef.status_kategorie], label: ef.status_label };
}

/**
 * Statusanzeige eines disponierten Einsatzpersonals — dieselbe Vertragsgrenze wie
 * {@link fahrzeugStatusDarstellung}, deren Kommentar die Herleitung trägt. Das Backend
 * prüft `status_farbe` hier ebenso wenig (`src/routes/personal_status.rs`); die Farbe geht
 * deshalb auf Rand und Text, nicht auf eine Fläche.
 */
export function personalStatusDarstellung(ep: EinsatzPersonal): StatusDarstellung {
  if (!ep.status_label || !ep.status_kategorie) return { rolle: 'neutral', label: 'kein Status' };
  return { ...statusKategorie[ep.status_kategorie], label: ep.status_label };
}
