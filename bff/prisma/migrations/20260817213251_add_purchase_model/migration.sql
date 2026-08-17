-- CreateEnum
CREATE TYPE "public"."PurchasePlan" AS ENUM ('PREMIUM', 'KRONIQ');

-- CreateEnum
CREATE TYPE "public"."PurchaseProvider" AS ENUM ('DUMMY_PAY', 'GOOGLE_PLAY');

-- CreateEnum
CREATE TYPE "public"."PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."Purchase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "plan" "public"."PurchasePlan" NOT NULL,
    "provider" "public"."PurchaseProvider" NOT NULL,
    "status" "public"."PurchaseStatus" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "providerReference" VARCHAR(255),
    "accessTokenHash" VARCHAR(255),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "resolvedAt" TIMESTAMP(6),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "public"."Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_status_idx" ON "public"."Purchase"("status");

-- CreateIndex
CREATE INDEX "Purchase_provider_idx" ON "public"."Purchase"("provider");

-- AddForeignKey
ALTER TABLE "public"."Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
