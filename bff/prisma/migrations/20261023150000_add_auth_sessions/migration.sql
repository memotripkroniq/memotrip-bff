-- Additive migration: no existing users, purchases or credentials are rewritten.
BEGIN;
CREATE TABLE "public"."AuthSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "accessTtlSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "revokedAt" TIMESTAMP(6),
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_accessTtlSeconds_check" CHECK ("accessTtlSeconds" IN (900, 604800)),
    CONSTRAINT "AuthSession_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "public"."RefreshToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(6),
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthSession_userId_idx" ON "public"."AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "public"."AuthSession"("expiresAt");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "public"."RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_sessionId_idx" ON "public"."RefreshToken"("sessionId");
ALTER TABLE "public"."AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "public"."AuthSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
COMMIT;
