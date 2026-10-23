import { HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthSession, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_AUDIENCE, ACCESS_ISSUER, OPAQUE_TOKEN_PATTERN, SESSION_SECONDS } from './auth-tokens';
import { TokenResponseDto } from './dto/token-response.dto';

export function authUnauthorized(code: string): UnauthorizedException {
    return new UnauthorizedException({ statusCode: 401, code, message: 'Authentication is required.' });
}

// All session mutations and credential changes lock User first, in the same order.
// PostgreSQL locks span processes; a JavaScript mutex would not protect replicas.
export async function lockAuthUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "public"."User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}

export async function revokeUserSessions(tx: Prisma.TransactionClient, userId: string) {
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

@Injectable()
export class AuthSessionService {
    constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

    private hash(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        try {
            return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        } catch (error) {
            if (error instanceof HttpException) throw error;
            // Do not log ORM errors: their metadata may contain credential hashes.
            throw new ServiceUnavailableException({ statusCode: 503, code: 'AUTH_TEMPORARILY_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' });
        }
    }

    private async issue(tx: Prisma.TransactionClient, session: AuthSession, email: string): Promise<TokenResponseDto> {
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = Math.min(session.accessTtlSeconds, Math.floor(session.expiresAt.getTime() / 1000) - now);
        if (expiresIn <= 0) throw authUnauthorized('REFRESH_TOKEN_INVALID');
        const refreshToken = randomBytes(32).toString('base64url');
        const accessToken = this.jwt.sign({ sub: session.userId, email, sid: session.id, tokenUse: 'access', iat: now }, {
            algorithm: 'HS256', issuer: ACCESS_ISSUER, audience: ACCESS_AUDIENCE, expiresIn,
        });
        await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: this.hash(refreshToken) } });
        return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn, refreshTokenExpiresAt: session.expiresAt.toISOString(), sessionId: session.id, userId: session.userId };
    }

    async create(userId: string, accessTtlSeconds: number, expectedPasswordHash?: string): Promise<TokenResponseDto> {
        return this.transaction(async tx => {
            await lockAuthUser(tx, userId);
            const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, deletedAt: true, passwordhash: true } });
            if (!user || user.deletedAt || (expectedPasswordHash !== undefined && user.passwordhash !== expectedPasswordHash)) {
                throw authUnauthorized('ACCESS_TOKEN_INVALID');
            }
            const session = await tx.authSession.create({ data: { userId, accessTtlSeconds, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
            return this.issue(tx, session, user.email);
        });
    }

    async refresh(token: string): Promise<TokenResponseDto> {
        if (!OPAQUE_TOKEN_PATTERN.test(token)) throw authUnauthorized('REFRESH_TOKEN_INVALID');
        const tokenHash = this.hash(token);
        const result = await this.transaction(async tx => {
            const reference = await tx.refreshToken.findUnique({ where: { tokenHash }, select: { session: { select: { userId: true } } } });
            if (!reference) return { code: 'REFRESH_TOKEN_INVALID' } as const;
            await lockAuthUser(tx, reference.session.userId);
            // Re-read after acquiring the lock; the pre-lock read can be stale.
            const current = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: { include: { user: { select: { email: true, deletedAt: true } } } } } });
            if (!current || current.session.revokedAt || current.session.user.deletedAt || current.session.expiresAt.getTime() <= Date.now()) {
                return { code: 'REFRESH_TOKEN_INVALID' } as const;
            }
            if (current.consumedAt) {
                await tx.authSession.update({ where: { id: current.sessionId }, data: { revokedAt: new Date() } });
                // Return an error marker: throwing here would roll back the revocation.
                return { code: 'REFRESH_TOKEN_REUSED' } as const;
            }
            await tx.refreshToken.update({ where: { id: current.id }, data: { consumedAt: new Date() } });
            return this.issue(tx, current.session, current.session.user.email);
        });
        if ('code' in result) throw authUnauthorized(result.code);
        return result;
    }

    async logout(token: string): Promise<void> {
        if (!OPAQUE_TOKEN_PATTERN.test(token)) return;
        await this.transaction(async tx => {
            const current = await tx.refreshToken.findUnique({ where: { tokenHash: this.hash(token) }, select: { sessionId: true, session: { select: { userId: true } } } });
            if (!current) return;
            await lockAuthUser(tx, current.session.userId);
            // A consumed token still identifies its family and can log it out.
            await tx.authSession.updateMany({ where: { id: current.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
        });
    }
}
