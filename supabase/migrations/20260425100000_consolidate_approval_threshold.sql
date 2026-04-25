UPDATE owner_pm_relationships
SET contract_maintenance_threshold = approval_threshold
WHERE approval_threshold IS NOT NULL
AND contract_maintenance_threshold IS NULL;

ALTER TABLE owner_pm_relationships
DROP COLUMN approval_threshold;