import webpush from 'web-push';

/**
 * Notificaciones Web Push (VAPID). Las claves salen de VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY; si no están, se generan una vez y se guardan en la base
 * de datos para que las suscripciones sigan valiendo tras reiniciar.
 */
export class PushService {
  constructor(store, { env = process.env, log = console, sender = webpush } = {}) {
    this.store = store;
    this.log = log;
    this.sender = sender;
    let publicKey = env.VAPID_PUBLIC_KEY;
    let privateKey = env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      publicKey = store.getMeta('vapid_public');
      privateKey = store.getMeta('vapid_private');
      if (!publicKey || !privateKey) {
        ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
        store.setMeta('vapid_public', publicKey);
        store.setMeta('vapid_private', privateKey);
        log.info?.('[push] claves VAPID generadas y guardadas en la base de datos');
      }
    }
    this.publicKey = publicKey;
    this.options = {
      vapidDetails: { subject: env.VAPID_SUBJECT || 'mailto:admin@runrun.invalid', publicKey, privateKey },
    };
  }

  /**
   * Envía a todos los dispositivos del usuario. Las suscripciones caducadas
   * (404/410) se borran. Nunca lanza: una notificación perdida no rompe nada.
   * @param {{title: string, body: string, tag: string, url: string, kind: string, data?: object}} payload
   */
  async sendTo(userId, payload, { ttl = 3600, urgency = 'normal' } = {}) {
    const subs = this.store.pushSubscriptionsOf(userId);
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (sub) => {
      try {
        await this.sender.sendNotification(sub, body, { ...this.options, TTL: ttl, urgency, topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) });
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) this.store.removePushSubscription(sub.endpoint);
        else this.log.warn?.(`[push] fallo al enviar (${err?.statusCode ?? err?.message})`);
      }
    }));
    return subs.length;
  }
}
