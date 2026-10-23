import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn() })) }));
import { OAuth2Client } from 'google-auth-library';

describe('Auth compatibility and safe logging', () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const jwt = new JwtService({ secret: 'auth-test-secret', signOptions: { expiresIn: '7d' } });
    const prisma = { user: { findFirst: jest.fn(), create: jest.fn() } };
    let service: AuthService;
    const user = { id: 'user-a', email: 'a@example.com', passwordhash: '' };
    beforeEach(async () => {
        jest.clearAllMocks();
        process.env.GOOGLE_CLIENT_ID = 'test-client';
        user.passwordhash = await bcrypt.hash('password123', 4);
        service = new AuthService(prisma as unknown as PrismaService, jwt);
    });
    afterAll(() => {
        if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = originalClientId;
    });
    it('preserves password login response and seven-day JWT', async () => {
        prisma.user.findFirst.mockResolvedValue(user);
        const response = await service.login(user.email, 'password123');
        expect(Object.keys(response)).toEqual(['accessToken']);
        const payload = jwt.verify(response.accessToken);
        expect(payload.sub).toBe(user.id);
        expect(payload.exp - payload.iat).toBe(7 * 86400);
        await expect(service.login(user.email, 'wrong')).rejects.toMatchObject({ status: 401 });
    });
    it('preserves signup response and hashes the password', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue(user);
        const response = await service.register({ email: user.email, password: 'password123' });
        expect(Object.keys(response)).toEqual(['accessToken']);
        expect(jwt.verify(response.accessToken).sub).toBe(user.id);
        expect(await bcrypt.compare('password123', prisma.user.create.mock.calls[0][0].data.passwordhash)).toBe(true);
    });
    it('preserves Google token response and expirations', async () => {
        const client = (OAuth2Client as unknown as jest.Mock).mock.results[0].value;
        client.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: 'google-user', email: user.email }) });
        prisma.user.findFirst.mockResolvedValue(user);
        const response = await service.googleLogin('google-id-token');
        expect(Object.keys(response).sort()).toEqual(['accessToken', 'refreshToken']);
        const access = jwt.verify(response.accessToken);
        const refresh = jwt.verify(response.refreshToken);
        expect(access.sub).toBe(user.id);
        expect(access.exp - access.iat).toBe(900);
        expect(refresh.exp - refresh.iat).toBe(30 * 86400);
    });
    it('never logs a provider error containing the submitted token', async () => {
        const client = (OAuth2Client as unknown as jest.Mock).mock.results[0].value;
        client.verifyIdToken.mockRejectedValue(new Error('invalid secret-id-token'));
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
            await expect(service.googleLogin('secret-id-token')).rejects.toMatchObject({ status: 401 });
            expect(warn).toHaveBeenCalledWith('Google ID token verification failed');
            expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-id-token');
        } finally { warn.mockRestore(); }
    });
});
