SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Automated channel events have no human author. Keep existing authors and
-- authorization records intact while allowing those events to remain clearly
-- attributed to the automation metadata instead of a contact owner.
ALTER TABLE "activity" ALTER COLUMN "createdById" DROP NOT NULL;
