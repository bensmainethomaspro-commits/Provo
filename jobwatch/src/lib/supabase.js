import { createClient } from '@supabase/supabase-js';

// Même projet Supabase que Provo : le compte existant fonctionne ici aussi.
export const supabase = createClient(
  'https://usztistixgzdrvjzplqx.supabase.co',
  'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD'
);
