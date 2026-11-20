/**
 * Sendeverb-Wächter (LLH-1766, Regel: `frontend/AGENTS.md`, „Erfassungs-Norm“, „Ein
 * Sendeverb.“): der Sendeknopf einer Erfassung heißt „Erfassen“, beim Neuanlegen von Struktur
 * „Anlegen“, beim Bearbeiten „Speichern“; Fachhandlungen und Aktionen an bestehenden Datensätzen
 * behalten ihr Verb, weil der Knopf ihre Folge nennt. Ein neues Verb braucht einen Eintrag in
 * {@link ERLAUBT} mit Grund.
 *
 * ── Was dieser Wächter sieht ────────────────────────────────────────────────────
 * In jeder Quelldatei außer Tests die Zeichenketten im Wert von `erfassenText=` und `knopfText=`
 * (direkt oder in einem `{…}`-Ausdruck, etwa einer Bedingung aus zwei Texten). Erlaubt ist ein
 * Text, der einem Eintrag gleicht oder mit „‹Eintrag› “ beginnt („Erfassen als 14:20“).
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 * Knopftexte als Kind eines `<Button>` (die Erfassungen mit eigenem Knopf hält je ein
 * Komponententest fest: ETB, „/person“, Infotelefon, Chat, Gerät-Meldung, Patient-Notiz), `okText`
 * handgebauter Dialoge und ob „Speichern“ wirklich nur beim Bearbeiten steht.
 */
import { describe, expect, it } from 'vitest';

const dateien = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const quellen = Object.entries(dateien).filter(([pfad]) => !/\.test\.tsx$/.test(pfad));

const ERLAUBT: readonly string[] = [
  // Die drei Grundverben (R2.1, R2.2).
  'Erfassen',
  'Anlegen',
  'Speichern',
  // Formen desselben Verbs mit fester Bedeutung.
  'Berichtigung erfassen',
  'Berichtigung speichern',
  'Änderung speichern',
  'Verbleib speichern',
  'Entwurf anlegen',
  // Fachhandlungen: der Knopf nennt ihre Folge (R2.3).
  'Auftrag erteilen',
  'Entlassen',
  'Disponieren',
  'Registrieren',
  'Zuordnen',
  'Als weiteren Posten zuordnen',
  'Zuweisen',
  'Melden',
  'Einheit bilden',
  'Bilden',
  'Ablegen',
  'Heraufstufen',
  'Koppeln',
  'Eintragen',
  'Einrichten',
  'Ausgeben',
  'Sichern',
  'Nachtragen',
  'Schichten erzeugen',
  'Übernehmen',
  'Weiteren Posten übernehmen',
  'Eintreffen buchen',
  'Unangemeldet buchen',
  'Aufnehmen',
  'Zählen',
  'Weiter',
  // Aktionen an bestehenden Datensätzen, keine Erfassungen.
  'Abschließen',
  'Abziehen',
  'Anlass festlegen',
  'Aufteilen',
  'Berichtigen',
  'Bestätigen',
  'Download starten',
  'Einsatz abschließen',
  'Einsatz schwärzen lassen',
  'Einsatz wieder öffnen',
  'Einspielen',
  'Frist aufheben',
  'Frist setzen',
  'Führung übernehmen',
  'Führung zurückholen',
  'Haushalt abmelden',
  'Haushalt ändern',
  'Hierher',
  'Passwort ändern',
  'Person abmelden',
  'Person schwärzen lassen',
  'Prüfen',
  'Schicht beginnen',
  'Stelle schließen',
  'Streichen',
  'Transport festlegen',
  'Verlängern',
  'Verlegen',
  'Vollziehen',
  'Vollzogen',
  'Wiederherstellen',
];

const WERT = /\b(?:erfassenText|knopfText)=("[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})/g;
const TEXT = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;

function istErlaubt(text: string): boolean {
  return ERLAUBT.some((e) => text === e || text.startsWith(`${e} `));
}

/** Knopftexte einer Quelle, die kein erlaubtes Verb tragen. */
export function verbVerstoesse(inhalt: string): string[] {
  return Array.from(inhalt.matchAll(WERT), (m) => m[1])
    .flatMap((wert) => Array.from(wert.matchAll(TEXT), (t) => t[1] ?? t[2] ?? t[3] ?? ''))
    .filter((text) => /^[A-ZÄÖÜ]/.test(text) && !istErlaubt(text));
}

describe('Ein Sendeverb (LLH-1766)', () => {
  it('erkennt Verb mit Objekt und fremde Verben (Gegenprobe)', () => {
    expect(verbVerstoesse('erfassenText="Meldung erfassen"')).toEqual(['Meldung erfassen']);
    expect(verbVerstoesse("knopfText={'Hinzufügen'}")).toEqual(['Hinzufügen']);
    expect(verbVerstoesse("erfassenText={neu ? 'Anlegen' : 'Absetzen'}")).toEqual(['Absetzen']);
    expect(verbVerstoesse('erfassenText="Erfassen"')).toEqual([]);
    expect(verbVerstoesse('erfassenText={`Erfassen als ${zeit}`}')).toEqual([]);
    expect(verbVerstoesse('erfassenText="Anlegen und Code zeigen"')).toEqual([]);
  });

  it('jeder Sendeknopf der Hülle trägt ein erlaubtes Verb', () => {
    const verstoesse = quellen.flatMap(([pfad, inhalt]) =>
      verbVerstoesse(inhalt).map((v) => `${pfad}: ${v}`),
    );
    expect(verstoesse).toEqual([]);
  });
});
