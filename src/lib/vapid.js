/**
 * La clé publique qui identifie ce serveur auprès des services de push.
 *
 * Elle n'est **pas** un secret : elle est transmise au service de push par le
 * navigateur, et vit de toute façon dans le bundle. La garder dans le dépôt
 * évite une variable d'environnement de plus à poser à la main sur Vercel —
 * et évite surtout qu'un déploiement l'oublie et que les rappels cessent sans
 * que personne ne comprenne pourquoi.
 *
 * Sa jumelle privée, elle, ne quitte jamais les secrets Supabase. C'est le
 * workflow « Installer les rappels » qui pose les deux, d'un seul geste.
 *
 * Vide = les rappels ne sont pas installés, et l'app le dit franchement au
 * lieu d'afficher un interrupteur mort.
 */
export const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BFlVLGz4OrOyFdxzYBS_dOa6xsoVdHoI5UbhYqOxbHoYZJipESrIoNCkU_YTNK9oBTl9Gx-PJU_UeGj0q9Fcbts';
