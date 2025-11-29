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
    async register(data: RegisterDto) {
        console.log("🔥 SIGNUP START", data);

        const { email, password } = data;

        const existing = await this.prisma.user.findUnique({
            where: { email },
        });

        console.log("🔍 EXISTING USER:", existing);

        if (existing) {
            console.log("❌ Email already exists");
            throw new BadRequestException('Email already exists');
        }

        const hashed = await bcrypt.hash(password, 10);
        console.log("🔐 HASHED PASSWORD:", hashed);

        const user = await this.prisma.user.create({
            data: {
                email,
                passwordhash: hashed,
            },
        });

        console.log("✅ USER CREATED:", user);

        const token = this.generateToken(user.id, user.email);

        console.log("🎟️ TOKEN:", token);
        return token;
    }


    // ======================
    // LOGIN
    // ======================
    async login(email: string, password: string) {
        console.log("🔥 LOGIN START:", email, password);

        const user = await this.usersService.validateUser(email, password);

        console.log("🔍 VALIDATED USER:", user);

        if (!user) {
            const exists = await this.usersService.findUserByEmail(email);
            console.log("🔎 FIND USER:", exists);

            if (exists && !exists.passwordhash) {
                console.log("❌ LOGIN GOOGLE ONLY");
                throw new UnauthorizedException("NO_PASSWORD_USE_GOOGLE");
            }

            console.log("❌ WRONG PASSWORD");
            throw new UnauthorizedException("WRONG_PASSWORD");
        }

        console.log("✅ LOGIN SUCCESS:", user.id);

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
