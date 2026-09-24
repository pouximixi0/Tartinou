// Web Push sans dépendance : VAPID (JWT ES256, RFC 8292) et chiffrement du
// message (aes128gcm, RFC 8291 / RFC 8188) avec node:crypto.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Paire de clés VAPID : { publicKey, privateKey } en base64url (65 octets bruts / 32 octets bruts). */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function privateKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey },
    format: 'jwk',
  });
}

/** En-tête Authorization pour un endpoint donné. */
export function vapidAuthorization(endpoint, subject, publicKey, privateKey) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}

/** Chiffre `payload` (Buffer) pour un abonnement { p256dh, auth }. Retourne le corps binaire aes128gcm. */
export function encryptPayload(payload, { p256dh, auth }) {
  const clientPub = fromB64u(p256dh);
  const clientAuth = fromB64u(auth);
  const local = crypto.createECDH('prime256v1');
  local.generateKeys();
  const localPub = local.getPublicKey();
  const shared = local.computeSecret(clientPub);
  const salt = crypto.randomBytes(16);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, localPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, clientAuth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const padded = Buffer.concat([payload, Buffer.from([2])]); // délimiteur du dernier enregistrement
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([localPub.length]), localPub]);
  return Buffer.concat([header, encrypted]);
}

/**
 * Envoie une notification. Résout { ok, status } ; status 404/410 = abonnement mort.
 * `sub` = { endpoint, p256dh, auth } ; `payload` = objet JSON.
 */
export async function sendPush(sub, payload, { publicKey, privateKey, subject }, ttl = 86400) {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: String(ttl),
      Urgency: 'normal',
      Authorization: vapidAuthorization(sub.endpoint, subject, publicKey, privateKey),
    },
    body,
  });
  return { ok: res.ok, status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
}
