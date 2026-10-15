import { apiGet, apiSend } from './client';
import type { WebPushStand } from './types';

/**
 * Web Push (LLH-1223, Spec `web-push`). Ohne `--web-push` am Server antworten alle drei mit 404,
 * ein Gerätekonto mit 403.
 */
export function ladeWebPushStand(): Promise<WebPushStand> {
  return apiGet<WebPushStand>('/api/web-push');
}

/** Abo dieses Browsers, wie `PushSubscription.toJSON()` es liefert (`keys` flach gelegt). */
export interface WebPushAboEingabe {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Meldet das Abo dieses Browsers für diese Sitzung an; dasselbe Abo hängt der Server um. */
export function meldeWebPushAn(abo: WebPushAboEingabe): Promise<void> {
  return apiSend<void>('/api/web-push/abo', 'PUT', abo);
}

/** Meldet das Abo dieser Sitzung ab; idempotent. */
export function meldeWebPushAb(): Promise<void> {
  return apiSend<void>('/api/web-push/abo', 'DELETE');
}
