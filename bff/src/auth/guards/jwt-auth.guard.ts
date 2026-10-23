import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { authUnauthorized } from '../auth-session.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    handleRequest<TUser = any>(err: any, user: any, info: any): TUser {
        if (err) throw err;
        if (!user) throw authUnauthorized(info?.name === 'TokenExpiredError' ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID');
        return user;
    }
}
