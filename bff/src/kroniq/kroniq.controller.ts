import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddKroniqGuestResponseDto } from './dto/add-kroniq-guest-response.dto';
import { AddKroniqGuestDto } from './dto/add-kroniq-guest.dto';
import { AddKroniqMemberResponseDto } from './dto/add-kroniq-member-response.dto';
import { AddKroniqMemberDto } from './dto/add-kroniq-member.dto';
import { DeleteKroniqImageResponseDto } from './dto/delete-kroniq-image-response.dto';
import { KroniqMeResponseDto } from './dto/kroniq-me-response.dto';
import { KroniqImageResponseDto } from './dto/kroniq-image-response.dto';
import { RemoveKroniqMemberResponseDto } from './dto/remove-kroniq-member-response.dto';
import { KroniqService } from './kroniq.service';

@ApiTags('Kroniq')
@Controller('kroniq')
export class KroniqController {
    constructor(private readonly kroniqService: KroniqService) {}

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Get('me')
    @ApiOperation({ summary: 'Get current user KroniQ data' })
    @ApiOkResponse({ type: KroniqMeResponseDto })
    async getMe(@Req() req: any) {
        return this.kroniqService.getMe(req.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('me/photo')
    @ApiOperation({ summary: 'Upload current user KroniQ image' })
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
    @ApiOkResponse({ type: KroniqImageResponseDto })
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    async uploadPhoto(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
        return this.kroniqService.uploadPhoto(req.user.sub, file);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('me/members')
    @ApiOperation({ summary: 'Add member to current user KroniQ' })
    @ApiOkResponse({ type: AddKroniqMemberResponseDto })
    async addMember(@Req() req: any, @Body() body: AddKroniqMemberDto) {
        return this.kroniqService.addMember(req.user.sub, body);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('me/guests')
    @ApiOperation({ summary: 'Add guest to current user KroniQ for 48 hours' })
    @ApiOkResponse({ type: AddKroniqGuestResponseDto })
    async addGuest(@Req() req: any, @Body() body: AddKroniqGuestDto) {
        return this.kroniqService.addGuest(req.user.sub, body);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Delete('me/members/:memberId')
    @ApiOperation({ summary: 'Remove member from current user KroniQ' })
    @ApiOkResponse({ type: RemoveKroniqMemberResponseDto })
    async removeMember(@Req() req: any, @Param('memberId') memberId: string) {
        return this.kroniqService.removeMember(req.user.sub, memberId);
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Delete('me/photo')
    @ApiOperation({ summary: 'Delete current user KroniQ image' })
    @ApiOkResponse({ type: DeleteKroniqImageResponseDto })
    async deletePhoto(@Req() req: any) {
        return this.kroniqService.deletePhoto(req.user.sub);
    }
}
