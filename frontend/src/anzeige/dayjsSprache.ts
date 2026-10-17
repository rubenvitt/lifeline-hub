/**
 * Registriert die dayjs-Sprache `de` (Spec `zeiteingabe`, „Kalender als Nebenweg“): antd fragt
 * den Wochenbeginn bei dayjs ab (`de_DE` → `de`); ohne geladene Sprache gilt Englisch, und die
 * Woche begann am Sonntag. Der Import ändert die globale dayjs-Sprache NICHT — Formate wie
 * `MMM` bleiben, wie sie sind; nur wer `.locale('de')` verlangt, bekommt Deutsch.
 *
 * Der Kalender des Bausteins importiert dieses Modul selbst, damit er auch ohne `main.tsx`
 * (Tests, Druckfenster) mit Montag beginnt.
 */
import 'dayjs/locale/de';
