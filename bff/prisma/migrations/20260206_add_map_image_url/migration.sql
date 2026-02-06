-- Add mapImageUrl to Trips (safe if already exists)
ALTER TABLE "Trips"
ADD COLUMN IF NOT EXISTS "mapImageUrl" VARCHAR(512);
