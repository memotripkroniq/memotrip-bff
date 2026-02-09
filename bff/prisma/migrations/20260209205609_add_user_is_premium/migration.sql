/*
  Warnings:

  - You are about to drop the column `description` on the `Trips` table. All the data in the column will be lost.
  - You are about to drop the column `themeId` on the `Trips` table. All the data in the column will be lost.
  - You are about to drop the column `createdat` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `isPremiumMonthly` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `ispremiumyearly` on the `User` table. All the data in the column will be lost.
  - Added the required column `destination` to the `Trips` table without a default value. This is not possible if the table is not empty.
  - Added the required column `from` to the `Trips` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to` to the `Trips` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transport` to the `Trips` table without a default value. This is not possible if the table is not empty.
  - Made the column `startDate` on table `Trips` required. This step will fail if there are existing NULL values in that column.
  - Made the column `endDate` on table `Trips` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `Trips` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."Trips" DROP CONSTRAINT "Trips_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Trips" DROP CONSTRAINT "Trips_themeId_fkey";

-- AlterTable
ALTER TABLE "public"."TripMapCache" ADD COLUMN     "imageFullUrl" VARCHAR(512),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Trips" DROP COLUMN "description",
DROP COLUMN "themeId",
ADD COLUMN     "destination" VARCHAR NOT NULL,
ADD COLUMN     "from" VARCHAR NOT NULL,
ADD COLUMN     "theme" VARCHAR,
ADD COLUMN     "to" VARCHAR NOT NULL,
ADD COLUMN     "transport" VARCHAR NOT NULL,
ADD COLUMN     "waypoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "startDate" SET NOT NULL,
ALTER COLUMN "endDate" SET NOT NULL,
ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "mapImageFullUrl" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "createdat",
DROP COLUMN "isPremiumMonthly",
DROP COLUMN "ispremiumyearly",
ADD COLUMN     "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isKroniq" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "public"."Trips" ADD CONSTRAINT "Trips_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
