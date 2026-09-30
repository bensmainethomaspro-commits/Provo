import { createClient } from '@supabase/supabase-js';

// Publics tous les deux (l'adresse de l'API et la clé publiable voyagent dans
// le paquet du navigateur) : exportés pour les appels qui passent à côté du
// client, comme le dépôt des pièces jointes (hooks/usePiecesSync.js).
export const SUPABASE_URL = 'https://usztistixgzdrvjzplqx.supabase.co';
export const SUPABASE_CLE = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';

export const supabase = createClient(SUPABASE_URL, SUPABASE_CLE);
