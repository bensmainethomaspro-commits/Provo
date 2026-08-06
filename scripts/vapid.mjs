#!/usr/bin/env node
/**
 * Fabrique la paire de clés VAPID qui signe les notifications.
 *
 * À lancer **sur ta machine**, une seule fois : `npm run vapid`.
 *
 * La clé privée ne doit jamais passer par une conversation, un dépôt, ni un
 * journal d'exécution — elle sort ici, dans ton terminal, et va directement
 * dans Supabase. La clé publique, elle, est faite pour être dans le bundle.
 */
import { webcrypto } from 'node:crypto';

const paire = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const publique = await webcrypto.subtle.exportKey('jwk', paire.publicKey);
const privee = await webcrypto.subtle.exportKey('jwk', paire.privateKey);

// La clé publique côté navigateur est le point non compressé : 0x04 ‖ x ‖ y.
const b64url = (s) => Buffer.from(s, 'base64url');
const brut = Buffer.concat([Buffer.from([4]), b64url(publique.x), b64url(publique.y)]);

console.log(`
═══════════════════════════════════════════════════════════════════
  Clés VAPID — à poser à DEUX endroits
═══════════════════════════════════════════════════════════════════

1 ▸ Supabase › Edge Functions › Secrets
    Nom    : VAPID_KEYS
    Valeur : (tout ce qui suit, sur une seule ligne)

${JSON.stringify({ publicKey: publique, privateKey: privee })}

2 ▸ Vercel › Settings › Environment Variables  (et .env.local)
    Nom    : VITE_VAPID_PUBLIC_KEY
    Valeur :

${brut.toString('base64url')}

═══════════════════════════════════════════════════════════════════
  Ne colle JAMAIS le bloc 1 ailleurs que dans Supabase.
═══════════════════════════════════════════════════════════════════
`);
