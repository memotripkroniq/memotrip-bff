import {
    Injectable,
    BadRequestException,
    UnauthorizedException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { UsersService } from '../users/users.service';


@Injectable()
export class AuthService {

    private googleClient: OAuth2Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
    ) {
        // inicializace nesmí být v parametru — musí být zde
        this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    }

    // ======================
    // REGISTER
    // ======================
    async register({ email, password }: RegisterDto) {
        // 1️⃣ trim + lowercase pro jistotu
        const cleanEmail = email.trim().toLowerCase();

        // 2️⃣ existuje už?
        const existing = await this.prisma.user.findUnique({
            where: { email: cleanEmail },
        });

        if (existing) {
            throw new BadRequestException("Email already exists");
        }

        // 3️⃣ hash hesla
        const hashed = await bcrypt.hash(password, 10);

        // 4️⃣ vytvoření uživatele
        const user = await this.prisma.user.create({
            data: {
                email: cleanEmail,
                passwordhash: hashed,
                name: null,            // 🔥 explicitně null
                provider: null,        // 🔥 žádný provider
                providerId: null,      // 🔥 žádné Google ID
            },
        });

        // 5️⃣ vrať token
        return {
            access_token: this.jwtService.sign({
                sub: user.id,
                email: user.email,
            }),
        };
    }


    // ======================
    // LOGIN
    // ======================
    async login(email: string, password: string) {
        const user = await this.usersService.validateUser(email, password);

        if (!user) {
            // email existuje, ale nemá heslo → Google user
            const exists = await this.usersService.findUserByEmail(email);
            if (exists && !exists.passwordhash) {
                throw new UnauthorizedException("NO_PASSWORD_USE_GOOGLE");
            }

            // email neexistuje nebo špatné heslo
            throw new UnauthorizedException("WRONG_PASSWORD");
        }

        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email
        });

        return { access_token: token };
    }


    // ======================
    // JWT TOKEN
    // ======================
    private generateToken(id: string, email: string) {
        const payload = { sub: id, email };

        return {
            access_token: this.jwtService.sign(payload),
        };
    }

    async googleLogin(idToken: string) {
        // 1) Verify token with Google
        const ticket = await this.googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            throw new UnauthorizedException("Google login did not return an email");
        }

        const email = payload.email;
        const name = payload.name ?? "Google User";
        const googleUserId = payload.sub;

        // 2) Find user
        let user = await this.prisma.user.findUnique({
            where: { email },
        });

        // 3) Create user if not exists
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    email,
                    name,
                    passwordhash: null,
                    provider: 'GOOGLE',
                    providerId: googleUserId,
                },
            });
        }

        // 4) Create JWT tokens
        const accessToken = this.jwtService.sign(
            { userId: user.id },
            { expiresIn: '15m' }
        );

        const refreshToken = this.jwtService.sign(
            { userId: user.id },
            { expiresIn: '30d' }
        );

        return {
            accessToken,
            refreshToken,
        };
    }
}
