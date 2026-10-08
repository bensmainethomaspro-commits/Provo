
-- Break the circular RLS dependency between trips and trip_members.
-- The old owner_manage_members policy on trip_members queried trips with RLS,
-- which triggered trips.member_select, which queried trip_members again → infinite recursion.

-- Step 1: Create a SECURITY DEFINER function that checks trip ownership
-- bypassing RLS (runs as the function definer, not the calling user).
CREATE OR REPLACE FUNCTION is_trip_owner(p_trip_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips WHERE id = p_trip_id AND owner_id = auth.uid()
  );
$$;

-- Step 2: Drop the recursive policy
DROP POLICY IF EXISTS "owner_manage_members" ON trip_members;

-- Step 3: Recreate using the SECURITY DEFINER function (no RLS on the trips lookup)
CREATE POLICY "owner_manage_members" ON trip_members
  FOR ALL
  USING (is_trip_owner(trip_id));
