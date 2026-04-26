CREATE OR REPLACE FUNCTION admin_purge_bookings(
  p_batch_id uuid DEFAULT NULL,
  p_property_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_ids uuid[];
  v_count integer;
BEGIN
  IF (p_batch_id IS NOT NULL)::int + 
     (p_property_id IS NOT NULL)::int + 
     (p_owner_id IS NOT NULL)::int != 1 THEN
    RAISE EXCEPTION 'Exactly one of p_batch_id, p_property_id, or p_owner_id must be provided';
  END IF;

  IF p_batch_id IS NOT NULL THEN
    SELECT array_agg(b.id) INTO v_booking_ids
    FROM bookings b WHERE b.upload_batch_id = p_batch_id;
  ELSIF p_property_id IS NOT NULL THEN
    SELECT array_agg(b.id) INTO v_booking_ids
    FROM bookings b WHERE b.property_id = p_property_id;
  ELSIF p_owner_id IS NOT NULL THEN
    SELECT array_agg(b.id) INTO v_booking_ids
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
    WHERE p.owner_id = p_owner_id;
  END IF;

  IF v_booking_ids IS NULL OR array_length(v_booking_ids, 1) = 0 THEN
    RETURN jsonb_build_object('deleted', 0, 'message', 'No bookings found for given scope');
  END IF;

  v_count := array_length(v_booking_ids, 1);

  UPDATE tickets
  SET related_booking_id = NULL
  WHERE related_booking_id = ANY(v_booking_ids);

  DELETE FROM booking_revenue_allocations
  WHERE grouped_booking_id = ANY(v_booking_ids);

  DELETE FROM bookings
  WHERE group_booking_id = ANY(v_booking_ids);

  DELETE FROM bookings
  WHERE id = ANY(v_booking_ids);

  RETURN jsonb_build_object(
    'deleted', v_count,
    'message', format('Purged %s bookings', v_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_purge_bookings FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_purge_bookings TO authenticated;