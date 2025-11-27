import {
    Injectable,
    BadRequestException,
    UnauthorizedException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService
    ) {}

    // ======================
    // REGISTER
    // ======================
    async register(data: RegisterDto) {
        const { email, password } = data;

        const existing = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existing) {
            throw new BadRequestException('Email already exists');
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await this.prisma.user.create({
            data: {
                email,
                passwordhash: hashed,
            },
        });

        return this.generateToken(user.id, user.email);
    }

    // ======================
    // LOGIN
    // ======================
    async login(email: string, password: string) {
        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new NotFoundException({
                error: "EMAIL_NOT_FOUND",
                message: "Incorrect email"
            });
        }

        const validPassword = await bcrypt.compare(password, user.passwordhash);

        if (!validPassword) {
            throw new UnauthorizedException({
                error: "WRONG_PASSWORD",
                message: "Incorrect password"
            });
        }

        const token = await this.jwtService.signAsync({
            sub: user.id,
            email: user.email
        });

        return {
            access_token: token
        };
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
}
