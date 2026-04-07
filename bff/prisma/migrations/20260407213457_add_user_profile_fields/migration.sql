-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "firstName" VARCHAR(255),
ADD COLUMN     "gender" VARCHAR(50),
ADD COLUMN     "lastName" VARCHAR(255);
