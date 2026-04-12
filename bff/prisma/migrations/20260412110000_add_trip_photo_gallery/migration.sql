CREATE TABLE "TripPhotoCategory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPhotoCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripPhoto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "imageUrl" VARCHAR(1024) NOT NULL,
    "thumbnailUrl" VARCHAR(1024) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripPhotoCategory_tripId_idx" ON "TripPhotoCategory"("tripId");
CREATE INDEX "TripPhoto_tripId_idx" ON "TripPhoto"("tripId");
CREATE INDEX "TripPhoto_categoryId_idx" ON "TripPhoto"("categoryId");

ALTER TABLE "TripPhotoCategory"
ADD CONSTRAINT "TripPhotoCategory_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "Trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "TripPhoto"
ADD CONSTRAINT "TripPhoto_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "Trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "TripPhoto"
ADD CONSTRAINT "TripPhoto_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "TripPhotoCategory"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
