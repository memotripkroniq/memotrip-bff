-- AlterTable
ALTER TABLE "public"."Trips" ADD COLUMN     "plannedBudget" TEXT,
ADD COLUMN     "spentBudget" TEXT;

-- CreateTable
CREATE TABLE "public"."TripChecklistItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripNote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL,
    "text" VARCHAR(5000) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripTipAndTrip" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL,
    "title" VARCHAR(2000) NOT NULL,
    "imageUrl" VARCHAR(1024),
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripTipAndTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripChecklistItem_tripId_idx" ON "public"."TripChecklistItem"("tripId");

-- CreateIndex
CREATE INDEX "TripNote_tripId_idx" ON "public"."TripNote"("tripId");

-- CreateIndex
CREATE INDEX "TripTipAndTrip_tripId_idx" ON "public"."TripTipAndTrip"("tripId");

-- AddForeignKey
ALTER TABLE "public"."TripChecklistItem" ADD CONSTRAINT "TripChecklistItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripNote" ADD CONSTRAINT "TripNote_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripTipAndTrip" ADD CONSTRAINT "TripTipAndTrip_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
