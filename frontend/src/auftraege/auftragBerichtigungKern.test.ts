import { describe, expect, it } from 'vitest';
import type { Auftrag, AuftragEmpfaenger } from '../api/types';
import { berichtigungAus, vorbelegungAus } from './auftragBerichtigungKern';

const empf = (over: Partial<AuftragEmpfaenger>): AuftragEmpfaenger =>
  ({
    id: 1,
    auftrag_id: 1,
    empfaenger_typ: 'funktion',
    abschnitt_id: null,
    einheit_id: null,
    person_id: null,
    fahrzeug_id: null,
    funktion_text: null,
    extern_kategorie: null,
    extern_bezeichnung: null,
    snap_anzeige: 'x',
    quittiert_at: null,
    quittiert_von_id: null,
    ...over,
  }) as AuftragEmpfaenger;

const auftrag = (over: Partial<Auftrag> = {}): Auftrag =>
  ({
    id: 1,
    lfd_nr: 4,
    auftrag_text: 'Sandsäcke zum Deich',
    absicht: null,
    lage: null,
    ort: null,
    zeit: null,
    mittel: 'LKW',
    verbindung: null,
    sicherheit: null,
    prioritaet: 'normal',
    richtung: 'intern',
    frist_at: '2026-10-12 13:00:00',
    erteilt_at: '2026-10-12 12:00:00',
    empfaenger: [
      empf({ id: 1, empfaenger_typ: 'abschnitt', abschnitt_id: 3 }),
      empf({ id: 2, empfaenger_typ: 'einheit', einheit_id: 9 }),
      empf({ id: 3, funktion_text: 'Logistiktrupp' }),
      empf({ id: 4, funktion: 's3', funktion_text: null }),
    ],
    ...over,
  }) as unknown as Auftrag;

describe('vorbelegungAus (LLH-1098)', () => {
  it('belegt das Formular mit dem Stand des Auftrags vor', () => {
    const { werte, empfaengerAenderbar } = vorbelegungAus(auftrag());
    expect(empfaengerAenderbar).toBe(true);
    expect(werte.text).toBe('Sandsäcke zum Deich');
    expect(werte.empfaenger).toEqual(['abschnitt:3', 'einheit:9', 'Logistiktrupp', 'funktion:s3']);
    expect(werte.mittel).toBe('LKW');
    expect(werte.lage).toBe('');
    expect(werte.prioritaet).toBe('normal');
    expect(werte.frist?.toISOString()).toBe('2026-10-12T13:00:00.000Z');
  });

  it('übernimmt einen externen Adressaten in die Felder der Richtung', () => {
    const { werte, empfaengerAenderbar } = vorbelegungAus(
      auftrag({
        richtung: 'extern',
        empfaenger: [
          empf({
            empfaenger_typ: 'extern',
            extern_kategorie: 'leitstelle',
            extern_bezeichnung: 'ILS Nord',
          }),
        ],
      }),
    );
    expect(empfaengerAenderbar).toBe(true);
    expect(werte.empfaenger).toEqual([]);
    expect(werte.externKategorie).toBe('leitstelle');
    expect(werte.externBezeichnung).toBe('ILS Nord');
  });

  it('sperrt die Empfänger, die das Formular nicht abbilden kann', () => {
    expect(
      vorbelegungAus(auftrag({ empfaenger: [empf({ empfaenger_typ: 'person', person_id: 5 })] }))
        .empfaengerAenderbar,
    ).toBe(false);
  });

  it('sperrt die Empfänger, wenn ein Ziel aufgelöst ist (LLH-1176)', () => {
    const { werte, empfaengerAenderbar } = vorbelegungAus(
      auftrag({
        empfaenger: [
          empf({ id: 1, empfaenger_typ: 'einheit', einheit_id: null }),
          empf({ id: 2, empfaenger_typ: 'abschnitt', abschnitt_id: 3 }),
        ],
      }),
    );
    expect(empfaengerAenderbar).toBe(false);
    expect(werte.empfaenger).not.toContain('einheit:null');
  });
});

describe('berichtigungAus (LLH-1098)', () => {
  const katalog = [{ funktion: 's3' }] as never;

  it('ohne Änderung ist der Patch leer', () => {
    const { werte } = vorbelegungAus(auftrag());
    expect(berichtigungAus(werte, { ...werte }, katalog, true)).toEqual({});
  });

  it('nennt nur die geänderten Felder, ein geleertes Schemafeld als null', () => {
    const { werte } = vorbelegungAus(auftrag());
    const patch = berichtigungAus(
      werte,
      { ...werte, text: ' Sandsäcke zum Deich Nord ', prioritaet: 'sofort', mittel: '  ' },
      katalog,
      true,
    );
    expect(patch).toEqual({
      auftrag_text: 'Sandsäcke zum Deich Nord',
      prioritaet: 'sofort',
      mittel: null,
    });
  });

  it('eine entfernte Frist geht als null, eine neue im Drahtformat', () => {
    const { werte } = vorbelegungAus(auftrag());
    expect(berichtigungAus(werte, { ...werte, frist: null }, katalog, true)).toEqual({
      frist_at: null,
    });
    expect(
      berichtigungAus(werte, { ...werte, frist: werte.frist!.add(1, 'hour') }, katalog, true),
    ).toEqual({ frist_at: '2026-10-12 14:00:00' });
  });

  it('schickt bei geänderten Empfängern die ganze neue Liste', () => {
    const { werte } = vorbelegungAus(auftrag());
    expect(berichtigungAus(werte, { ...werte, empfaenger: ['einheit:9'] }, katalog, true)).toEqual({
      empfaenger: [{ empfaenger_typ: 'einheit', einheit_id: 9 }],
    });
  });

  it('dieselben Empfänger in anderer Reihenfolge gelten als unverändert (LLH-1176)', () => {
    const { werte } = vorbelegungAus(auftrag());
    const umsortiert = { ...werte, empfaenger: [...werte.empfaenger].reverse() };
    expect(berichtigungAus(werte, umsortiert, katalog, true)).toEqual({});
    expect(
      berichtigungAus(werte, { ...umsortiert, frist: werte.frist!.add(1, 'hour') }, katalog, true),
    ).toEqual({ frist_at: '2026-10-12 14:00:00' });
  });

  it('ein nicht eingehängtes Feld gilt als unverändert', () => {
    const { werte } = vorbelegungAus(auftrag());
    const ohneSchema = { ...werte } as Partial<typeof werte>;
    delete ohneSchema.mittel;
    expect(berichtigungAus(werte, ohneSchema as typeof werte, katalog, true)).toEqual({});
  });

  it('schickt keine Empfänger, wenn sie nicht änderbar sind', () => {
    const { werte } = vorbelegungAus(auftrag());
    expect(berichtigungAus(werte, { ...werte, empfaenger: [] }, katalog, false)).toEqual({});
  });
});
