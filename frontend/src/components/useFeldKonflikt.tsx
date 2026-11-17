import { App, Button } from 'antd';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { istKonflikt } from '../api/client';
import type { FeldVermerk } from '../api/types';
import { vermerkKurz } from './feldVermerk';
import { OFFEN_LASSEN } from './InlineAngabe';

/**
 * Der eine Ablauf „Zwischenzeitlich geändert“ für eine Einzelangabe (LLH-1831, Change
 * `nvhnqynd-konflikt-und-aenderungsvermerk`, design.md D6; Spec `formularseiten`, „Einheitlicher
 * Dialog“ und „409 ohne fremde Änderung steht an der Angabe“). Herausgelöst aus den Personendaten
 * (LLH-1103), genutzt von Einheit, Einsatzdaten und Führungsstelle.
 *
 * 1. Speichern MIT Altwert (`speichern(erwartet)`).
 * 2. Ein 409 lädt den Datensatz frisch. Steht die Angabe noch wie beim Öffnen, war es kein
 *    Feldkonflikt (etwa ein abgeschlossener Einsatz): der Fehler geht an die Angabe.
 * 3. Sonst fragt der Dialog mit dem aktuellen Wert und, soweit bekannt, Wer und Wann:
 *    „Meine Änderung übernehmen“ speichert ohne Altwert (`speichern(undefined)`), „Verwerfen und
 *    neu laden“ endet ohne Speichern mit {@link VERWORFEN} (der frische Stand liegt schon im
 *    Cache; der Aufrufer meldet nichts als gespeichert), Escape und Schließen
 *    entscheiden nichts und geben {@link OFFEN_LASSEN} zurück: die Eingabe bleibt offen.
 */
export interface FeldKonfliktAuftrag<W, D> {
  /** Name der Angabe, wie die Zeile ihn zeigt. */
  etikett: string;
  /** Der Wert beim Öffnen (Wire-Form), Altwert des Feld-CAS. */
  erwartet: W;
  /** Schickt die Änderung; mit `undefined` ohne Altwert. Lehnt bei Fehlern ab. */
  speichern: (erwartet: W | undefined) => Promise<void>;
  /** Lädt den Datensatz frisch (am Cache vorbei) und legt ihn dort ab. */
  ladeFrisch: () => Promise<D>;
  /**
   * Aktueller Wert der Angabe, ihr Vermerk und, wo der Wire-Wert nichts sagt (Kennungen, Codes,
   * Listen), ihr lesbarer Text im frischen Datensatz. `undefined`: den Datensatz gibt es nicht mehr
   * (etwa eine inzwischen aufgelöste Einheit) — dann ist es kein Feldkonflikt.
   */
  aktuell: (frisch: D) => { wert: W; vermerk?: FeldVermerk; anzeige?: string } | undefined;
  /** Lesbarer Text eines nicht leeren Werts für die Rückfrage, wenn `aktuell` keine `anzeige` gibt. */
  text: (wert: W) => string;
  /** Leer heißt „ohne Angabe“. Vorgabe: `null`, `undefined`, `''` oder leere Liste. */
  leer?: (wert: W) => boolean;
  /** Wertgleichheit in Wire-Form. Vorgabe: Vergleich der JSON-Form (auch für Listen). */
  gleich?: (a: W, b: W) => boolean;
}

/** Rückgabe nach „Verwerfen und neu laden“: nichts gesendet, die Angabe schließt (keine Meldung). */
export const VERWORFEN = Symbol('verworfen');

const jsonGleich = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const vorgabeLeer = (w: unknown) => w == null || w === '' || (Array.isArray(w) && w.length === 0);

export function useFeldKonflikt() {
  const { modal } = App.useApp();
  const { zeitKurz } = useAnzeigeKonventionen();

  return async function speichereMitKonflikt<W, D>(
    a: FeldKonfliktAuftrag<W, D>,
  ): Promise<void | typeof OFFEN_LASSEN | typeof VERWORFEN> {
    const gleich = a.gleich ?? jsonGleich;
    const leer = a.leer ?? vorgabeLeer;
    // Ohne Altwert gibt es keinen Feldkonflikt: ein 409 ist dann ein anderer Grund und gehört an
    // die Angabe.
    if (a.erwartet === undefined) {
      await a.speichern(undefined);
      return;
    }
    try {
      await a.speichern(a.erwartet);
      return;
    } catch (e) {
      if (!istKonflikt(e)) throw e;
      // Scheitert das Neuladen, bleibt der 409 der Grund an der Angabe (nicht der Ladefehler).
      let stand: ReturnType<typeof a.aktuell>;
      try {
        stand = a.aktuell(await a.ladeFrisch());
      } catch {
        throw e;
      }
      if (!stand || gleich(stand.wert, a.erwartet)) throw e;
      const { wert, vermerk, anzeige } = stand;
      const wer = vermerk ? ` (${vermerkKurz(vermerk, zeitKurz)})` : '';
      const entscheidung = await new Promise<'uebernehmen' | 'verwerfen' | 'offen'>((fertig) => {
        const rueckfrage = modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content: `${a.etikett} inzwischen: ${
            leer(wert) ? 'ohne Angabe' : `„${anzeige ?? a.text(wert)}“`
          }${wer}`,
          okText: 'Meine Änderung übernehmen',
          okButtonProps: { danger: true },
          onOk: () => fertig('uebernehmen'),
          // Escape und Schließen entscheiden nichts. Darum ist „Verwerfen“ ein eigener Knopf
          // statt antds Abbrechen (das auch Escape auslöst).
          onCancel: () => fertig('offen'),
          footer: (_, { OkBtn }) => (
            <>
              <Button
                onClick={() => {
                  fertig('verwerfen');
                  rueckfrage.destroy();
                }}
              >
                Verwerfen und neu laden
              </Button>
              <OkBtn />
            </>
          ),
        });
      });
      if (entscheidung === 'offen') return OFFEN_LASSEN;
      if (entscheidung === 'verwerfen') return VERWORFEN;
      // Ohne Altwert, bewusst über den neuen Stand. Ein zweiter 409 (Einsatz abgeschlossen) steht
      // an der Angabe.
      await a.speichern(undefined);
    }
  };
}
