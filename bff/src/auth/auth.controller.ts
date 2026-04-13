import {
    Body,
    Controller,
    Delete,
    Get,
    Patch,
    Post,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ChangePasswordResponseDto } from './dto/change-password-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { DeleteAccountResponseDto } from './dto/delete-account-response.dto';
import { DeleteProfileImageResponseDto } from './dto/delete-profile-image-response.dto';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { ProfileImageResponseDto } from './dto/profile-image-response.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Post('signup')
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    @Post('login')
    async login(@Body() dto: LoginDto) {
        return this.authService.login(dto.email, dto.password);
    }

    @Post('google')
    async google(@Body('idToken') idToken: string) {
        return this.authService.googleLogin(idToken);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Get('me')
    @ApiOperation({ summary: 'Get current user profile' })
    @ApiOkResponse({ type: MeResponseDto })
    async me(@Req() req: any) {
        return this.authService.getMe(req.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Patch('me')
    @ApiOperation({ summary: 'Update current user profile' })
    @ApiOkResponse({ type: MeResponseDto })
    async updateMe(@Req() req: any, @Body() body: UpdateMeDto) {
        return this.authService.updateMe(req.user.sub, body);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('me/password')
    @ApiOperation({ summary: 'Create or change current user password' })
    @ApiOkResponse({ type: ChangePasswordResponseDto })
    async changePassword(@Req() req: any, @Body() body: ChangePasswordDto) {
        return this.authService.changePassword(req.user.sub, body);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('me/photo')
    @ApiOperation({ summary: 'Upload current user profile photo' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary' },
            },
            required: ['file'],
        },
    })
    @ApiOkResponse({ type: ProfileImageResponseDto })
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    async uploadProfilePhoto(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
        return this.authService.uploadProfilePhoto(req.user.sub, file);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Delete('me')
    @ApiOperation({ summary: 'Delete current user account' })
    @ApiBody({ type: DeleteAccountDto })
    @ApiOkResponse({ type: DeleteAccountResponseDto })
    async deleteMe(@Req() req: any, @Body() body: DeleteAccountDto) {
        return this.authService.deleteAccount(req.user.sub, body);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Delete('me/photo')
    @ApiOperation({ summary: 'Delete current user profile photo' })
    @ApiOkResponse({ type: DeleteProfileImageResponseDto })
    async deleteProfilePhoto(@Req() req: any) {
        return this.authService.deleteProfilePhoto(req.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Get('limits/trips')
    async tripLimits(@Req() req: any) {
        return this.authService.getTripLimits(req.user.sub);
    }
}
