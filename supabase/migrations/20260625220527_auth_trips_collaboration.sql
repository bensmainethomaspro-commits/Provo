
-- ── Profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_emoji text DEFAULT '😀',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile_all" ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY "read_any_profile" ON profiles FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Trips ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- Policy propriétaire (sans référence à trip_members pour l'instant)
CREATE POLICY "owner_all" ON trips FOR ALL USING (owner_id = auth.uid());

-- ── Trip members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor',
  invite_code text UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_read_own" ON trip_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "owner_manage_members" ON trip_members FOR ALL USING (
  EXISTS (SELECT 1 FROM trips WHERE id = trip_id AND owner_id = auth.uid())
);
CREATE POLICY "join_by_invite" ON trip_members FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── Policies trips qui référencent trip_members (après sa création) ───────
CREATE POLICY "member_select" ON trips FOR SELECT USING (
  EXISTS (SELECT 1 FROM trip_members WHERE trip_id = trips.id AND user_id = auth.uid())
);
CREATE POLICY "member_update" ON trips FOR UPDATE USING (
  EXISTS (SELECT 1 FROM trip_members WHERE trip_id = trips.id AND user_id = auth.uid())
);

-- ── Fonction rejoindre via invite_code ───────────────────────────────────
CREATE OR REPLACE FUNCTION join_trip_by_invite(p_invite_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trip_id text;
  v_trip_data jsonb;
BEGIN
  SELECT tm.trip_id INTO v_trip_id
  FROM trip_members tm
  WHERE tm.invite_code = p_invite_code
  LIMIT 1;

  IF v_trip_id IS NULL THEN
    RETURN json_build_object('error', 'Code invalide');
  END IF;

  IF EXISTS (SELECT 1 FROM trip_members WHERE trip_id = v_trip_id AND user_id = auth.uid()) THEN
    SELECT data INTO v_trip_data FROM trips WHERE id = v_trip_id;
    RETURN json_build_object('trip_id', v_trip_id, 'data', v_trip_data);
  END IF;

  INSERT INTO trip_members (trip_id, user_id, role)
  VALUES (v_trip_id, auth.uid(), 'editor');

  SELECT data INTO v_trip_data FROM trips WHERE id = v_trip_id;
  RETURN json_build_object('trip_id', v_trip_id, 'data', v_trip_data);
END;
$$;

-- ── Realtime ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE trip_members;
