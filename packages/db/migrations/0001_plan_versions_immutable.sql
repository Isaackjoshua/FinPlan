-- Plan versions are history. Nothing may rewrite them, including our own code.
-- Rows can still be removed when the owning user is deleted (ON DELETE CASCADE).
CREATE FUNCTION reject_plan_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'plan_versions rows are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER plan_versions_immutable
  BEFORE UPDATE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION reject_plan_version_update();
