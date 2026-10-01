import { IkoneLupe } from '../ikonen';
import { adressBegriff } from '../anzeige/ortssuche';
import { lagekartePfad } from '../routing/deeplinks';
import { sprungZu, type Befehl, type Oeffnung } from './typen';

/**
 * Die Adresszeile der Sprungpalette (LFH-638, Spec `sprungpalette`, design.md D5): wer im Einsatz
 * etwas tippt, das eine Adresse sein kann, findet am ENDE der Treffer „Adresse auf Lagekarte
 * suchen · „…““. Die Zeile springt nur (`?ort=`); gesucht wird auf der Lagekarte. Die Palette
 * sucht live und entprellt, eine Abfrage beim Tippen verböten die Nominatim-Regeln — und so hat die
 * Adresssuche genau einen Aufrufer.
 *
 * Rein und exportiert. Die Rechteprüfung (Lagekarte frei?) liegt beim Aufrufer.
 */

/** Ein Buchstabe trennt eine Adresse von Nummern, Stärken und Kennungen („1234“, „#42“). */
const BUCHSTABE = /\p{L}/u;

/** Kann die Eingabe eine Adresse sein? Ab drei Zeichen, mit Buchstabe, keine Koordinate. */
export function istAdressEingabe(eingabe: string): boolean {
  const begriff = adressBegriff(eingabe);
  return begriff !== null && BUCHSTABE.test(begriff);
}

/**
 * Die Zeile „Adresse auf Lagekarte suchen · „<Text>““. Gruppe `ortssuche`, nicht merkbar (ein
 * getippter Suchtext ist kein wiederkehrender Befehl), ohne Vorschau. Die id trägt den Text, wie
 * beim Koordinatensprung: eine feste id ließe die Markierung an einem alten Begriff kleben.
 */
export function adressBefehl({
  einsatzId,
  text,
  navigate,
}: {
  einsatzId: number;
  text: string;
  /** `oeffnung` fehlt = im aktuellen Tab. */
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
}): Befehl {
  const begriff = text.trim();
  return {
    id: `adresse:${begriff}`,
    gruppe: 'ortssuche',
    label: `Adresse auf Lagekarte suchen · „${begriff}“`,
    kontext: 'Adresse',
    icon: IkoneLupe,
    ...sprungZu(lagekartePfad(einsatzId, { ort: begriff }), navigate),
  };
}
