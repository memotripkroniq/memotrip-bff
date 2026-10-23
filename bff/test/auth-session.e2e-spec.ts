import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { AuthSessionService } from '../src/auth/auth-session.service';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { ACCESS_AUDIENCE, ACCESS_ISSUER } from '../src/auth/auth-tokens';

jest.mock('../src/storage/r2-upload', () => ({ deletePublicFile: jest.fn(), uploadUserProfilePhoto: jest.fn() }));
jest.mock('../src/auth/send-reset-password-email', () => ({ sendResetPasswordEmail: jest.fn() }));
const mockGoogleVerify = jest.fn();
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: (...args: unknown[]) => mockGoogleVerify(...args) })) }));

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
// Opt-in only. Never fall back to DATABASE_URL or the project's .env.
const integration = databaseUrl ? describe : describe.skip;
integration('Auth sessions (real isolated PostgreSQL)', () => {
    let db: PrismaClient;
    let otherDb: PrismaClient;
    let app: INestApplication;
    let auth: AuthService;
    let sessions: AuthSessionService;
    let otherSessions: AuthSessionService;
    const jwt = new JwtService({ secret: 'phase2a-test-only-secret', signOptions: { expiresIn: '7d' } });
    // Same signer defaults and calls as dfa07bf AuthModule/AuthService. These are
    // real HS256 JWTs, without the new issuer, audience, tokenUse or session ID.
    const legacyJwt = new JwtService({ secret: 'phase2a-test-only-secret', signOptions: { expiresIn: '7d' } });
    const legacyTokens = (userId: string, email: string, issuedAt = Math.floor(Date.now() / 1000)) => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(issuedAt * 1000);
        try {
            return {
                googleAccess: legacyJwt.sign({ sub: userId }, { expiresIn: '15m' }),
                passwordAccess: legacyJwt.sign({ sub: userId, email }),
                googleRefresh: legacyJwt.sign({ sub: userId }, { expiresIn: '30d' }),
            };
        } finally { clock.mockRestore(); }
    };
    const oldEnv = { JWT_SECRET: process.env.JWT_SECRET, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, NODE_ENV: process.env.NODE_ENV, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL };
    const createdUsers: string[] = [];
    let tokens: Awaited<ReturnType<AuthService['register']>>;
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const me = (access: string) => request(app.getHttpServer()).get('/auth/me').auth(access, { type: 'bearer' });
    const refresh = (token: string) => request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: token });
    const logout = (token: string) => request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: token });
    const signup = async () => {
        const value = await auth.register({ email: `${randomUUID()}@example.com`, password: 'password123' });
        createdUsers.push(value.userId);
        return value;
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55439' || url.pathname !== '/auth_phase2a') {
            throw new Error('Refusing to run: AUTH_TEST_DATABASE_URL must target isolated loopback auth_phase2a on port 55439');
        }
        process.env.JWT_SECRET = 'phase2a-test-only-secret';
        process.env.GOOGLE_CLIENT_ID = 'test-google-client';
        process.env.NODE_ENV = 'development';
        process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
        db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        otherDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        await Promise.all([db.$connect(), otherDb.$connect()]);
        const module = await Test.createTestingModule({
            controllers: [AuthController, PaymentsController],
            providers: [AuthService, AuthSessionService, JwtStrategy, PaymentsService,
                { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt }],
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        auth = module.get(AuthService);
        sessions = module.get(AuthSessionService);
        otherSessions = new AuthSessionService(otherDb as unknown as PrismaService, jwt);
    });
    beforeEach(async () => { tokens = await signup(); });
    afterAll(async () => {
        if (db) {
            await db.user.deleteMany({ where: { id: { in: createdUsers } } });
            await db.$disconnect();
        }
        if (otherDb) await otherDb.$disconnect();
        if (app) await app.close();
        for (const [key, value] of Object.entries(oldEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });

    it('signs seven-day typed signup JWTs and stores only opaque token hashes', async () => {
        expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 604800 });
        expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(jwt.decode(tokens.refreshToken)).toBeNull();
        expect(jwt.verify(tokens.accessToken)).toMatchObject({ sub: tokens.userId, sid: tokens.sessionId, tokenUse: 'access', iss: ACCESS_ISSUER, aud: ACCESS_AUDIENCE });
        const stored = await db.refreshToken.findMany({ where: { sessionId: tokens.sessionId } });
        expect(stored).toHaveLength(1);
        expect(stored[0].tokenHash).toBe(hash(tokens.refreshToken));
        expect(JSON.stringify(stored)).not.toContain(tokens.refreshToken);
        await me(tokens.accessToken).expect(200);
    });

    it('preserves password login HTTP status and access lifetime, adding session fields', async () => {
        const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
        const result = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'password123' }).expect(201);
        expect(result.body).toMatchObject({ expiresIn: 604800, userId: tokens.userId });
        expect(result.headers['cache-control']).toBe('no-store');
        await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'wrong' }).expect(401);
    });

    it('creates a Google account with a fifteen-minute access and opaque refresh token', async () => {
        const email = `${randomUUID()}@example.com`;
        mockGoogleVerify.mockResolvedValue({ getPayload: () => ({ sub: randomUUID(), email }) });
        const result = await request(app.getHttpServer()).post('/auth/google').send({ idToken: 'google-id-token' }).expect(201);
        createdUsers.push(result.body.userId);
        expect(result.body).toMatchObject({ expiresIn: 900, tokenType: 'Bearer' });
        expect(result.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        await me(result.body.accessToken).expect(200);
        const renewed = await refresh(result.body.refreshToken).expect(200);
        expect(renewed.body.expiresIn).toBe(900);
    });

    it('preserves signup HTTP status and additive response', async () => {
        const result = await request(app.getHttpServer()).post('/auth/signup').send({ email: `${randomUUID()}@example.com`, password: 'password123' }).expect(201);
        createdUsers.push(result.body.userId);
        expect(result.body).toMatchObject({ expiresIn: 604800 });
        expect(result.headers['cache-control']).toBe('no-store');
    });

    it('rotates once without sliding session expiry and keeps seven-day password access', async () => {
        const result = await refresh(tokens.refreshToken).expect(200);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.body).toMatchObject({ sessionId: tokens.sessionId, userId: tokens.userId, expiresIn: 604800, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt });
        expect(result.body.refreshToken).not.toBe(tokens.refreshToken);
        expect(await db.refreshToken.count({ where: { sessionId: tokens.sessionId } })).toBe(2);
        const old = await db.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash(tokens.refreshToken) } });
        expect(old.consumedAt).not.toBeNull();
        await me(result.body.accessToken).expect(200);
    });

    it('caps renewed access JWT to the remaining absolute session lifetime', async () => {
        await db.authSession.update({ where: { id: tokens.sessionId }, data: { expiresAt: new Date(Date.now() + 60000) } });
        const result = await refresh(tokens.refreshToken).expect(200);
        expect(result.body.expiresIn).toBeGreaterThan(0);
        expect(result.body.expiresIn).toBeLessThanOrEqual(60);
        await me(result.body.accessToken).expect(200);
    });

    it('commits family revocation on reuse and immediately rejects all its access JWTs', async () => {
        const current = await refresh(tokens.refreshToken).expect(200);
        const replay = await refresh(tokens.refreshToken).expect(401);
        expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');
        expect((await db.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } })).revokedAt).not.toBeNull();
        expect((await me(current.body.accessToken).expect(401)).body.code).toBe('SESSION_REVOKED');
        await me(tokens.accessToken).expect(401);
        await refresh(current.body.refreshToken).expect(401);
    });

    it('serializes simultaneous refreshes across independent database clients', async () => {
        const result = await Promise.allSettled([sessions.refresh(tokens.refreshToken), otherSessions.refresh(tokens.refreshToken)]);
        expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
        const failure = result.find(value => value.status === 'rejected') as PromiseRejectedResult;
        expect(failure.reason.getResponse().code).toBe('REFRESH_TOKEN_REUSED');
        expect(await db.refreshToken.count({ where: { sessionId: tokens.sessionId } })).toBe(2);
        expect((await db.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } })).revokedAt).not.toBeNull();
    });

    it('rolls back token consumption if issuance fails and exposes no infrastructure details', async () => {
        const signing = jest.spyOn(jwt, 'sign').mockImplementationOnce(() => { throw new Error('private-infrastructure-detail'); });
        try {
            const result = await refresh(tokens.refreshToken).expect(503);
            expect(result.body.code).toBe('AUTH_TEMPORARILY_UNAVAILABLE');
            expect(JSON.stringify(result.body)).not.toContain('private-infrastructure-detail');
            expect((await db.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash(tokens.refreshToken) } })).consumedAt).toBeNull();
        } finally { signing.mockRestore(); }
        await refresh(tokens.refreshToken).expect(200);
    });

    it('logs out by a consumed token, idempotently, without affecting other sessions', async () => {
        const other = await sessions.create(tokens.userId, 604800);
        const current = await refresh(tokens.refreshToken).expect(200);
        await logout(tokens.refreshToken).expect(204);
        await logout(tokens.refreshToken).expect(204);
        await logout('unknown-token').expect(204);
        await me(current.body.accessToken).expect(401);
        await refresh(current.body.refreshToken).expect(401);
        await me(other.accessToken).expect(200);
    });

    it('cannot refresh a session after a concurrent logout', async () => {
        const result = await Promise.allSettled([otherSessions.refresh(tokens.refreshToken), sessions.logout(tokens.refreshToken)]);
        expect(result[1].status).toBe('fulfilled');
        expect((await db.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } })).revokedAt).not.toBeNull();
        await refresh(tokens.refreshToken).expect(401);
        const winner = result[0];
        if (winner.status === 'fulfilled') await me(winner.value.accessToken).expect(401);
    });

    it('rejects absolute session expiry for access and refresh', async () => {
        await db.authSession.update({ where: { id: tokens.sessionId }, data: { createdAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() - 1000) } });
        expect((await me(tokens.accessToken).expect(401)).body.code).toBe('SESSION_EXPIRED');
        expect((await refresh(tokens.refreshToken).expect(401)).body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('returns distinct access-expiry and invalid-access codes', async () => {
        const expired = jwt.sign({ sub: tokens.userId }, { expiresIn: -1 });
        expect((await me(expired).expect(401)).body.code).toBe('ACCESS_TOKEN_EXPIRED');
        expect((await me('invalid').expect(401)).body.code).toBe('ACCESS_TOKEN_INVALID');
        expect((await request(app.getHttpServer()).get('/auth/me').expect(401)).body.code).toBe('ACCESS_TOKEN_INVALID');
        await me(new JwtService({ secret: 'wrong-test-key' }).sign({ sub: tokens.userId }, { expiresIn: 900 })).expect(401);
        await me(jwt.sign({ sub: tokens.userId }, { algorithm: 'HS512', expiresIn: 900 })).expect(401);
    });

    it('accepts bounded actual legacy profiles but rejects legacy refresh JWTs immediately', async () => {
        await me(jwt.sign({ sub: tokens.userId, email: 'legacy@example.com' }, { expiresIn: '7d' })).expect(200);
        await me(jwt.sign({ sub: tokens.userId }, { expiresIn: '15m' })).expect(200);
        for (const payload of [{ sub: tokens.userId }, { sub: tokens.userId, email: 'legacy@example.com' }]) {
            const legacyRefresh = jwt.sign(payload, { expiresIn: '30d' });
            await me(legacyRefresh).expect(401);
            expect((await refresh(legacyRefresh).expect(401)).body.code).toBe('REFRESH_TOKEN_INVALID');
        }
        await me(jwt.sign({ sub: tokens.userId }, { expiresIn: '1d' })).expect(401);
        await me(jwt.sign({ sub: tokens.userId })).expect(401); // default seven days but no email
    });

    it('never accepts opaque refresh as Bearer or access JWT as refresh', async () => {
        await me(tokens.refreshToken).expect(401);
        await refresh(tokens.accessToken).expect(401);
        await me(tokens.accessToken).expect(200);
    });

    it('reproduces all original signing profiles with actual JWT signatures', async () => {
        const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
        const old = legacyTokens(user.id, user.email);
        for (const [name, value] of Object.entries(old)) {
            const payload = legacyJwt.verify(value);
            expect(payload.sub).toBe(user.id);
            expect(payload.exp - payload.iat).toBe(name === 'googleAccess' ? 900 : name === 'passwordAccess' ? 604800 : 2592000);
            expect(Object.keys(payload).sort()).toEqual((name === 'passwordAccess' ? ['email', 'exp', 'iat', 'sub'] : ['exp', 'iat', 'sub']).sort());
            expect((legacyJwt.decode(value, { complete: true }) as { header: { alg: string } }).header.alg).toBe('HS256');
        }
        await me(old.googleAccess).expect(200);
        await me(old.passwordAccess).expect(200);
        expect((await me(old.googleRefresh).expect(401)).body.code).toBe('ACCESS_TOKEN_INVALID');
        expect((await refresh(old.googleRefresh).expect(401)).body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it.each([
        ['googleAccess', 900], ['passwordAccess', 604800],
    ] as const)('honors the original %s expiry exactly, without granting a fresh lifetime', async (profile, lifetime) => {
        const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
        const issuedAt = Math.floor(Date.now() / 1000) - lifetime + 60;
        const original = legacyTokens(user.id, user.email, issuedAt)[profile];
        const payload = legacyJwt.verify(original);
        expect(payload.exp).toBe(issuedAt + lifetime);
        await me(original).expect(200);
        const count = await db.authSession.count({ where: { userId: user.id } });
        const clock = jest.spyOn(Date, 'now').mockReturnValue((payload.exp - 1) * 1000);
        try {
            await me(original).expect(200);
            clock.mockReturnValue(payload.exp * 1000);
            expect((await me(original).expect(401)).body.code).toBe('ACCESS_TOKEN_EXPIRED');
            clock.mockReturnValue((payload.exp + 1) * 1000);
            expect((await me(original).expect(401)).body.code).toBe('ACCESS_TOKEN_EXPIRED');
            expect((await refresh(original).expect(401)).body.code).toBe('REFRESH_TOKEN_INVALID');
        } finally { clock.mockRestore(); }
        expect(await db.authSession.count({ where: { userId: user.id } })).toBe(count);
    });

    it('fails closed for a missing new session instead of falling back to legacy validation', async () => {
        await db.authSession.delete({ where: { id: tokens.sessionId } });
        expect((await me(tokens.accessToken).expect(401)).body.code).toBe('SESSION_REVOKED');
        await refresh(tokens.refreshToken).expect(401);
    });

    it('fails closed when new session lookup is unavailable', async () => {
        const lookup = jest.spyOn(db.authSession, 'findFirst').mockRejectedValueOnce(new Error('private-db-error'));
        try {
            const response = await me(tokens.accessToken).expect(503);
            expect(response.body.code).toBe('AUTH_TEMPORARILY_UNAVAILABLE');
            expect(JSON.stringify(response.body)).not.toContain('private-db-error');
        } finally { lookup.mockRestore(); }
    });

    it('cannot downgrade a revoked new JWT by stripping modern claims without invalidating its signature', async () => {
        await logout(tokens.refreshToken).expect(204);
        const [header, encoded, signature] = tokens.accessToken.split('.');
        const originalPayload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        for (const removed of [['sid'], ['tokenUse'], ['iss'], ['aud'], ['sid', 'tokenUse', 'iss', 'aud']]) {
            const payload = { ...originalPayload };
            for (const key of removed) delete payload[key];
            const altered = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
            expect((await me(altered).expect(401)).body.code).toBe('ACCESS_TOKEN_INVALID');
            await refresh(altered).expect(401);
        }
        expect((await me(tokens.accessToken).expect(401)).body.code).toBe('SESSION_REVOKED');
    });

    // Explicit evidence of the approved migration limitation. Revoking a modern
    // session does not revoke independently issued, sessionless legacy JWTs.
    // A blanket requirement to revoke *all* old credentials is NOT satisfied.
    it.each(['logout', 'replay', 'password-change', 'password-reset'] as const)(
        'documents that independent legacy access JWTs still authorize after %s', async action => {
            const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
            const old = legacyTokens(user.id, user.email);
            if (action === 'logout') await logout(tokens.refreshToken).expect(204);
            if (action === 'replay') {
                await refresh(tokens.refreshToken).expect(200);
                expect((await refresh(tokens.refreshToken).expect(401)).body.code).toBe('REFRESH_TOKEN_REUSED');
            }
            if (action === 'password-change') {
                await auth.changePassword(user.id, { currentPassword: 'password123', newPassword: 'password456' });
            }
            if (action === 'password-reset') {
                const token = randomUUID();
                await db.passwordResetToken.create({ data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60000) } });
                await auth.resetPassword(token, 'password456');
            }
            expect((await me(tokens.accessToken).expect(401)).body.code).toBe('SESSION_REVOKED');
            await refresh(tokens.refreshToken).expect(401);
            await me(old.googleAccess).expect(200);
            await me(old.passwordAccess).expect(200);
            // Neither credential can be exchanged for a new session or token pair.
            await refresh(old.googleAccess).expect(401);
            await refresh(old.passwordAccess).expect(401);
            await me(old.googleRefresh).expect(401);
            await refresh(old.googleRefresh).expect(401);
            // Legacy credentials retain normal ownership restrictions, even here.
            const other = await signup();
            const purchase = await request(app.getHttpServer()).post('/payments/dummy')
                .auth(other.accessToken, { type: 'bearer' }).send({ plan: 'PREMIUM' }).expect(201);
            await request(app.getHttpServer()).get(`/payments/dummy/${purchase.body.purchaseId}/status`)
                .auth(old.passwordAccess, { type: 'bearer' }).expect(404);
        },
    );

    it('rejects missing, empty and wrong-scheme Authorization headers with a stable code', async () => {
        for (const authorization of ['', 'Bearer', 'Bearer ', `Basic ${tokens.accessToken}`]) {
            const response = await request(app.getHttpServer()).get('/auth/me').set('Authorization', authorization).expect(401);
            expect(response.body.code).toBe('ACCESS_TOKEN_INVALID');
        }
    });

    it.each([
        { tokenUse: 'refresh' }, { iss: 'other' }, { aud: 'other' },
        { sid: 'invalid' }, { sub: undefined }, { sub: '' },
    ])('rejects malformed or confused access claims %j', async overrides => {
        const base = jwt.decode(tokens.accessToken) as Record<string, unknown>;
        delete base.exp; delete base.iat;
        await me(jwt.sign({ ...base, ...overrides }, { expiresIn: 900 })).expect(401);
    });

    it('rejects a signed access JWT belonging to a different session owner', async () => {
        const other = await signup();
        const payload = jwt.decode(tokens.accessToken) as Record<string, unknown>;
        delete payload.exp; delete payload.iat;
        await me(jwt.sign({ ...payload, sub: other.userId }, { expiresIn: 900 })).expect(401);
        await me(other.accessToken).expect(200);
    });

    it('returns safe validation errors and generic invalid-token errors', async () => {
        for (const endpoint of ['/auth/refresh', '/auth/logout']) {
            for (const body of [{}, { refreshToken: 123 }, { refreshToken: '' }, { refreshToken: 'x'.repeat(4097) }]) {
                const result = await request(app.getHttpServer()).post(endpoint).send(body).expect(400);
                expect(result.body.code).toBe('VALIDATION_ERROR');
                expect(result.headers['cache-control']).toBe('no-store');
                expect(JSON.stringify(result.body)).not.toContain('refreshToken');
            }
        }
        expect((await refresh('a'.repeat(43)).expect(401)).body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('revokes every new session on password change, preserving login with the new password', async () => {
        const other = await sessions.create(tokens.userId, 604800);
        await request(app.getHttpServer()).post('/auth/me/password').auth(tokens.accessToken, { type: 'bearer' }).send({ currentPassword: 'password123', newPassword: 'password456' }).expect(201);
        for (const old of [tokens, other]) { await me(old.accessToken).expect(401); await refresh(old.refreshToken).expect(401); }
        const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
        expect((await auth.login(user.email, 'password456')).accessToken).toBeTruthy();
    });

    it('serializes password mutation with refresh under the same database lock', async () => {
        const result = await Promise.allSettled([
            otherSessions.refresh(tokens.refreshToken),
            auth.changePassword(tokens.userId, { currentPassword: 'password123', newPassword: 'password456' }),
        ]);
        expect(result[1].status).toBe('fulfilled');
        await me(tokens.accessToken).expect(401);
        if (result[0].status === 'fulfilled') await me(result[0].value.accessToken).expect(401);
    });

    it('does not create a session using stale password verification after credentials change', async () => {
        const user = await db.user.findUniqueOrThrow({ where: { id: tokens.userId } });
        await auth.changePassword(tokens.userId, { currentPassword: 'password123', newPassword: 'password456' });
        await expect(sessions.create(tokens.userId, 604800, user.passwordhash!)).rejects.toMatchObject({ status: 401 });
    });

    it('revokes sessions on password reset and consumes the reset token', async () => {
        const token = randomUUID();
        await db.passwordResetToken.create({ data: { userId: tokens.userId, token, expiresAt: new Date(Date.now() + 60000) } });
        await auth.resetPassword(token, 'password456');
        await me(tokens.accessToken).expect(401);
        await refresh(tokens.refreshToken).expect(401);
        await expect(auth.resetPassword(token, 'password789')).rejects.toMatchObject({ status: 400 });
    });

    it('rejects account deletion for all existing access profiles and new refresh tokens', async () => {
        await auth.deleteAccount(tokens.userId, { currentPassword: 'password123' });
        await me(tokens.accessToken).expect(401);
        await me(jwt.sign({ sub: tokens.userId, email: 'old@example.com' }, { expiresIn: '7d' })).expect(401);
        await refresh(tokens.refreshToken).expect(401);
    });

    it('keeps DummyPay ownership, URL-token flow and Google Play separation unchanged', async () => {
        const created = await request(app.getHttpServer()).post('/payments/dummy').auth(tokens.accessToken, { type: 'bearer' }).send({ plan: 'PREMIUM' }).expect(201);
        const id = created.body.purchaseId;
        const path = `/payments/dummy/${id}/status`;
        await request(app.getHttpServer()).get(path).expect(401);
        await request(app.getHttpServer()).get(path).auth(tokens.refreshToken, { type: 'bearer' }).expect(401);
        const other = await signup();
        await request(app.getHttpServer()).get(path).auth(other.accessToken, { type: 'bearer' }).expect(404);
        const url = new URL(created.body.paymentUrl);
        await request(app.getHttpServer()).get(url.pathname + url.search).expect(200);
        await request(app.getHttpServer()).post(url.pathname + '/resolve' + url.search).type('form').send({ result: 'APPROVED' }).expect(201);
        const renewed = await refresh(tokens.refreshToken).expect(200);
        const result = await request(app.getHttpServer()).get(path).auth(renewed.body.accessToken, { type: 'bearer' }).expect(200);
        expect(result.body).toMatchObject({ status: 'COMPLETED', provider: 'DUMMY_PAY' });
        await db.purchase.update({ where: { id }, data: { provider: 'GOOGLE_PLAY' } });
        await request(app.getHttpServer()).get(path).auth(renewed.body.accessToken, { type: 'bearer' }).expect(404);
        await logout(renewed.body.refreshToken).expect(204);
        await request(app.getHttpServer()).get(path).auth(renewed.body.accessToken, { type: 'bearer' }).expect(401);
    });
});
