import { huellePush } from '../huelle/faehigkeiten';
import { iosPushKanal } from './iosPush';
import {
  ladePushStand,
  pushAbgleichen,
  pushAusschalten,
  pushEinschalten,
  pushInhaltSetzen,
  type PushStand,
  type PushZustand,
} from './webPush';

/**
 * Der Weg, auf dem diese Seite Push bekommt: APNs in der iOS-Hülle (`iosPush.ts`), sonst Web Push
 * (`webPush.ts`). Schalter und Aufrufer kennen nur diese Form.
 */
export type PushKanal = {
  ladeStand(): Promise<PushStand>;
  einschalten(benutzerId: number): Promise<PushZustand>;
  ausschalten(benutzerId: number): Promise<PushZustand>;
  inhaltSetzen(benutzerId: number, an: boolean): Promise<boolean>;
  abgleichen(benutzerId: number, o?: { nurBeiBedarf?: boolean }): Promise<void>;
};

const webPushKanal: PushKanal = {
  ladeStand: () => ladePushStand(),
  einschalten: (id) => pushEinschalten(id),
  ausschalten: (id) => pushAusschalten(id),
  inhaltSetzen: (id, an) => pushInhaltSetzen(id, an),
  abgleichen: (id, o) => pushAbgleichen(id, o),
};

/** iOS-Push, wo die Hülle ihn kann (`huellePush()`), sonst Web Push. Beim Aufruf gewählt. */
export function pushKanal(): PushKanal {
  return huellePush() != null ? iosPushKanal : webPushKanal;
}
