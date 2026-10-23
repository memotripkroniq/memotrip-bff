import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { authUnauthorized } from '../auth-session.service';
import { ACCESS_AUDIENCE, ACCESS_ISSUER, GOOGLE_ACCESS_SECONDS, PASSWORD_ACCESS_SECONDS, UUID_PATTERN } from '../auth-tokens';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private readonly prisma: PrismaService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET,
            algorithms: ['HS256'],
        });
    }

    async validate(payload: any) {
        const invalid = () => authUnauthorized('ACCESS_TOKEN_INVALID');
        if (!payload || typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub) ||
            !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
            payload.exp <= payload.iat || payload.iat > Math.floor(Date.now() / 1000) + 30) throw invalid();

        const modern = ['sid', 'tokenUse', 'iss', 'aud'].some(key => key in payload);
        if (modern) {
            if (payload.tokenUse !== 'access' || payload.iss !== ACCESS_ISSUER || payload.aud !== ACCESS_AUDIENCE ||
                typeof payload.sid !== 'string' || !UUID_PATTERN.test(payload.sid) ||
                payload.exp - payload.iat > PASSWORD_ACCESS_SECONDS) throw invalid();
        } else {
            // Only the actual old issuance profiles are accepted. A 30-day Google
            // refresh JWT cannot pass either bound, even with a valid signature.
            if (Object.keys(payload).some(key => !['sub', 'email', 'iat', 'exp'].includes(key))) throw invalid();
            const hasEmail = typeof payload.email === 'string' && payload.email.length > 0;
            if (('email' in payload && !hasEmail) || payload.exp - payload.iat > (hasEmail ? PASSWORD_ACCESS_SECONDS : GOOGLE_ACCESS_SECONDS)) throw invalid();
        }

        try {
            const user = await this.prisma.user.findFirst({ where: { id: payload.sub, deletedAt: null }, select: { id: true } });
            if (!user) throw invalid();
            if (modern) {
                const session = await this.prisma.authSession.findFirst({ where: { id: payload.sid, userId: payload.sub } });
                if (!session || session.revokedAt) throw authUnauthorized('SESSION_REVOKED');
                if (session.expiresAt.getTime() <= Date.now()) throw authUnauthorized('SESSION_EXPIRED');
                if (payload.exp * 1000 > session.expiresAt.getTime() || payload.exp - payload.iat > session.accessTtlSeconds) throw invalid();
            }
            return { sub: payload.sub };
        } catch (error) {
            if (error instanceof HttpException) throw error;
            throw new ServiceUnavailableException({ statusCode: 503, code: 'AUTH_TEMPORARILY_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' });
        }
    }
}
