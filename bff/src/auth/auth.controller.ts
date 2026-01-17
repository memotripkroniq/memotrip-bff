import {Body, Controller, Get, Post, Req, UseGuards} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Post('signup')
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    @Post("login")
    async login(@Body() dto: LoginDto) {
        return this.authService.login(dto.email, dto.password);
    }

    @Post('google')
    async google(@Body('idToken') idToken: string) {
        return this.authService.googleLogin(idToken);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get('me')
    async me(@Req() req: any) {
        return this.authService.getMe(req.user.sub);
    }
}
