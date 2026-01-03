-- CreateTable
CREATE TABLE IF NOT EXISTS "TripMapCache" (
                                              "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cacheKey" VARCHAR(64) NOT NULL,
    "imageUrl" VARCHAR(512) NOT NULL,
    "fromText" VARCHAR(255),
    "toText" VARCHAR(255),
    "transport" VARCHAR(50),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripMapCache_pkey" PRIMARY KEY ("id")
    );

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TripMapCache_cacheKey_key"
    ON "TripMapCache"("cacheKey");
