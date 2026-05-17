-- Sprint 11 Row 137: Migrate net_owner_revenue → gross_revenue on bookings
-- gross_revenue column already exists (empty). net_owner_revenue holds all data.
-- Step 1: Copy data into gross_revenue
UPDATE bookings 
SET gross_revenue = net_owner_revenue 
WHERE net_owner_revenue IS NOT NULL;

-- Step 2: Drop the old column
ALTER TABLE bookings 
DROP COLUMN net_owner_revenue;
