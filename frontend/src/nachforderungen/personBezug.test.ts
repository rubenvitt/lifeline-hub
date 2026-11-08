import { describe, expect, it } from 'vitest';
import type { RettungsmittelStand } from '../api/types';
import {
  prioritaetAusTransport,
  rettungsmittelAnforderbar,
  rettungsmittelMarke,
  rettungsmittelName,
} from './personBezug';

const stand = (over: Partial<RettungsmittelStand> = {}): RettungsmittelStand => ({
  nachforderung_id: 3,
  art: 'RTW',
  status: 'angefordert',
  rufnamen: [],
  ...over,
});

describe('Rettungsmittel für einen Patienten (LLH-1573)', () => {
  it('Priorität aus der Transportpriorität (D3)', () => {
    expect(prioritaetAusTransport('sofort')).toBe('sofort');
    expect(prioritaetAusTransport('dringlich')).toBe('dringend');
    expect(prioritaetAusTransport('normal')).toBe('normal');
    expect(prioritaetAusTransport(null)).toBeUndefined();
  });

  it('anforderbar ohne Stand und nach einer Absage, sonst nicht (D3/D4)', () => {
    expect(rettungsmittelAnforderbar(null)).toBe(true);
    expect(rettungsmittelAnforderbar(stand({ status: 'abgelehnt' }))).toBe(true);
    for (const status of ['angefordert', 'zugesagt', 'unterwegs', 'eingetroffen'] as const) {
      expect(rettungsmittelAnforderbar(stand({ status }))).toBe(false);
    }
  });

  it('wer kommt: erster Rufname, sonst die Art', () => {
    expect(rettungsmittelName(stand())).toBe('RTW');
    expect(rettungsmittelName(stand({ rufnamen: ['RTW 1/83-1', 'NEF'] }))).toBe('RTW 1/83-1');
  });

  it('Marke an der UHS (D4)', () => {
    expect(rettungsmittelMarke(undefined)).toBeNull();
    expect(rettungsmittelMarke(stand())).toBe('RTW angefordert');
    expect(rettungsmittelMarke(stand({ status: 'zugesagt' }))).toBe('RTW zugesagt');
    expect(rettungsmittelMarke(stand({ status: 'unterwegs' }))).toBe('RTW unterwegs');
    expect(rettungsmittelMarke(stand({ status: 'eingetroffen' }))).toBe('RTW da');
    expect(rettungsmittelMarke(stand({ status: 'abgelehnt' }))).toBeNull();
  });
});
