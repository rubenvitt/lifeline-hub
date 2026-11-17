import { Button, Form, Popover } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { registrierAnzeige } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, Sichtungskategorie } from '../api/types';
import SichtungsTag from '../components/SichtungsTag';
import { ErfassungsFormular } from '../components/Erfassung';
import { useRollen } from '../components/instrument';
import { SK_META } from './personMeta';
import { useSaveSichtung } from './SichtungDialog';
import SichtungsWahl, { SICHTUNGSFLAECHE_BREITE, sichtungsLuecke } from './SichtungsWahl';

/**
 * Was die Seite einer Zeilenaktion mitgibt (LLH-1130, Change
 * `n08alz2v-betroffenenliste-zeilenaktionen`, design.md D4/D5). Alle Wege sind stabil
 * (`useCallback`), damit die gemerkten Spalten der `Datensicht` stehen bleiben.
 */
export interface ZeilenRueckmeldung {
  /** `onMutate`: eine neue Aktion an der Zeile räumt ihren alten Grund (`useZeilenFehler`). */
  beginne: (personId: number) => void;
  /** `onError`: der Grund steht an der Zeile; die Seite verwirft ihn nach einem Einsatzwechsel. */
  melde: (personId: number, fehler: unknown, einsatzId: number) => void;
  /** Ein Popover oder Menü der Zeile geht auf oder zu: die Liste hält Menge und Folge. */
  hold: (quelle: string, offen: boolean) => void;
}

interface ZeilenSichtungProps {
  p: Person;
  einsatzId: number;
  rueckmeldung: ZeilenRueckmeldung;
  /** Eine Nachsichtung dieser Person liegt ohne Netz in der Warteschlange (LLH-1138). */
  vorgemerkt?: boolean;
}

interface SichtungEingabe {
  kategorie: Sichtungskategorie;
}

/**
 * Die Sichtungszelle als Auslöser der Nachsichtung (Spec `betroffene-lagedaten`, „Sichtung und
 * Verbleib aus der Betroffenenliste“; design.md D1): ein Tipp öffnet ein Popover mit der
 * Flächenwahl (`SichtungsWahl`, LLH-1083) und „Übernehmen“. Zelle, Fläche, „Übernehmen“: drei
 * Tipps, ohne Umweg über die Detailseite.
 *
 * - Ein Knopf in Steuerhöhe (antd-`Button`), sein Name trägt die Kennung („Sichtung R-007 ändern,
 *   aktuell SK II“). Der Klick bleibt in der Zelle, sonst öffnete die Zeile die Detailseite.
 * - „Übernehmen“ schließt sofort; bis der neue Stand in der Liste steht, zeigt die Zelle die
 *   gewählte Kategorie mit Ladeanzeige. Eine Ablehnung steht an der Zeile (`ZeilenFehler` der
 *   `Datensicht`, design.md D5), nicht im Popover: das ist dann schon zu.
 * - Solange das Popover offen ist, hält die Liste Menge und Folge (`hold`, design.md D4). Der
 *   Halt hängt an einem Effekt: verschwindet die Zeile mit offenem Popover, gibt er ihn frei.
 * - Kein Notizfeld und kein „Bestätigt von“: beides bleibt der Nachsichtung im Patientenkopf und im
 *   Dialog. Die Wahl beginnt leer, auch eine bestätigte gleiche Kategorie ist eine Nachsichtung.
 * - Ohne Netz merkt die Zelle vor (LLH-1138, Spec `betroffene-lagedaten`): sie zeigt weiter den
 *   Serverstand, darunter „Offline vorgemerkt“, bis der Abgleich die Sichtung gesendet hat.
 */
export default function ZeilenSichtung({
  p,
  einsatzId,
  rueckmeldung,
  vorgemerkt = false,
}: ZeilenSichtungProps) {
  const { token, rollen } = useRollen();
  const qc = useQueryClient();
  const [form] = Form.useForm<SichtungEingabe>();
  const [offen, setOffen] = useState(false);
  const ausloeser = useRef<HTMLButtonElement>(null);
  const warOffen = useRef(false);
  const kennung = registrierAnzeige(p.registrier_nr);
  const { beginne, melde, hold } = rueckmeldung;
  const saveSichtung = useSaveSichtung();

  const mutation = useMutation({
    // Merkt ohne Netz selbst vor (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
    networkMode: 'always',
    mutationFn: (v: { einsatzId: number; kategorie: Sichtungskategorie }) =>
      saveSichtung(v.einsatzId, p, { kategorie: v.kategorie }),
    onMutate: () => beginne(p.id),
    onError: (fehler, v) => melde(p.id, fehler, v.einsatzId),
    // Zurückgegeben: die Zelle bleibt `isPending`, bis der neue Stand in der Liste steht.
    // Vorgemerkt gibt es keinen neuen Stand; die Quittung liest die Seite aus der Warteschlange.
    onSuccess: (ergebnis, v) =>
      ergebnis.zustand === 'vorgemerkt' ||
      Promise.all([
        qc.invalidateQueries({ queryKey: einsatzKeys.personen(v.einsatzId) }),
        qc.invalidateQueries({ queryKey: einsatzKeys.person(v.einsatzId, p.id) }),
        qc.invalidateQueries({ queryKey: einsatzKeys.etb(v.einsatzId) }),
      ]),
  });

  const quelle = `sichtung:${p.id}`;
  useEffect(() => {
    if (!offen) return;
    hold(quelle, true);
    return () => hold(quelle, false);
  }, [offen, quelle, hold]);

  // Nach dem Schließen zurück auf den Auslöser: wer per Tastatur nachsichtet, steht wieder in der
  // Zeile (und die Liste behält den Fokus, wie vor dem Öffnen).
  useEffect(() => {
    if (offen) warOffen.current = true;
    else if (warOffen.current) {
      warOffen.current = false;
      ausloeser.current?.focus();
    }
  }, [offen]);

  const laeuft = mutation.isPending;
  const gezeigt = laeuft ? mutation.variables.kategorie : (p.aktuelle_sichtung ?? null);
  const name = gezeigt
    ? `Sichtung ${kennung} ändern, aktuell ${SK_META[gezeigt].label}`
    : `${kennung} sichten`;

  const inhalt = (
    <section
      aria-label={`Sichtung ${kennung}`}
      data-lfh="zeilen-sichtung"
      // Drei Flächen je Reihe, auch am Handy (3 × 96 px plus Lücken).
      style={{ width: 3 * SICHTUNGSFLAECHE_BREITE + 2 * sichtungsLuecke(token) }}
    >
      <ErfassungsFormular<SichtungEingabe>
        form={form}
        erfassenText="Übernehmen"
        // Kein Warten auf die Antwort: das Popover schließt, die Ablehnung steht an der Zeile
        // (design.md D1/D5). Die Hülle leert danach nur ein Formular, das ohnehin verschwindet.
        onErfassen={(v) => {
          mutation.mutate({ einsatzId, kategorie: v.kategorie });
          return Promise.resolve();
        }}
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
      >
        <Form.Item
          name="kategorie"
          rules={[{ required: true, message: 'Bitte eine Sichtungskategorie wählen' }]}
        >
          <SichtungsWahl aria-label={`Sichtungskategorie für ${kennung}`} />
        </Form.Item>
      </ErfassungsFormular>
    </section>
  );

  return (
    // Der Klick gehört der Zelle, sonst navigierte die Zeile auf die Detailseite (`onZeileKlick`
    // greift nur Anker ab). Klicks aus dem Portal hält die Zeile selbst fern.
    <div onClick={(e) => e.stopPropagation()}>
      <Popover
        open={offen}
        onOpenChange={setOffen}
        trigger="click"
        placement="bottomLeft"
        destroyOnHidden
        content={inhalt}
      >
        <Button
          ref={ausloeser}
          type={gezeigt ? 'text' : 'link'}
          aria-label={name}
          aria-expanded={offen}
          aria-busy={laeuft || undefined}
          loading={laeuft}
          data-lfh="sichtung-ausloeser"
          style={{ paddingInline: token.paddingXS }}
        >
          {gezeigt ? <SichtungsTag kategorie={gezeigt} /> : 'Sichten'}
        </Button>
      </Popover>
      {vorgemerkt && (
        <div data-lfh="zeile-vorgemerkt" style={{ fontSize: 12, color: rollen.text2 }}>
          Offline vorgemerkt
        </div>
      )}
    </div>
  );
}
