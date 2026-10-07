import { beforeEach, describe, expect, it } from 'vitest';
import { LETZTER_ORT_FRIST_MS, leseLetztenOrt, merkeLetztenOrt } from './letzterOrt';

const A = 3;
const B = 4;

describe('letzterOrt', () => {
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuch nichts', () => {
    expect(leseLetztenOrt(A, Date.now())).toBeNull();
  });

  it('merkt Einsatz und Adresse samt Suche', () => {
    merkeLetztenOrt(A, { einsatzId: 5, pfad: '/einsaetze/5/personen?sicht=karte' }, 1000);
    expect(leseLetztenOrt(A, 2000)).toEqual({
      einsatzId: 5,
      pfad: '/einsaetze/5/personen?sicht=karte',
    });
  });

  it('gehört der Person, nicht dem Browser', () => {
    // Am geteilten Fükw-Rechner führte der Rückweg sonst in den Einsatz der vorigen Schicht.
    merkeLetztenOrt(A, { einsatzId: 5, pfad: '/einsaetze/5/etb' }, 1000);
    expect(leseLetztenOrt(B, 2000)).toBeNull();
  });

  it('verfällt nach einer Schicht', () => {
    merkeLetztenOrt(A, { einsatzId: 5, pfad: '/einsaetze/5/etb' }, 0);
    expect(leseLetztenOrt(A, LETZTER_ORT_FRIST_MS)).not.toBeNull();
    expect(leseLetztenOrt(A, LETZTER_ORT_FRIST_MS + 1)).toBeNull();
  });

  it('nimmt fremden Inhalt als „nichts gemerkt“', () => {
    for (const roh of [
      '42',
      '{"einsatzId":"5","pfad":"/x","at":1}',
      'kein json',
      '{"einsatzId":5,"pfad":"//fremd.example","at":1}',
    ]) {
      localStorage.setItem(`lfh:nav:letzter-ort:${A}`, roh);
      expect(leseLetztenOrt(A, 2), roh).toBeNull();
    }
  });

  it('nimmt nur Adressen eines Einsatzes an', () => {
    // Der Rückweg führt per `navigate` dorthin; eine fremde Adresse im Speicher darf nirgends
    // anders hinführen als in den gemerkten Einsatz.
    merkeLetztenOrt(A, { einsatzId: 5, pfad: '/admin/benutzer' }, 1);
    expect(leseLetztenOrt(A, 2)).toBeNull();
    merkeLetztenOrt(A, { einsatzId: 5, pfad: '/einsaetze/6/etb' }, 1);
    expect(leseLetztenOrt(A, 2)).toBeNull();
  });
});
