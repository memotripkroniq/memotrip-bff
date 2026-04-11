import {
    Controller,
    Delete,
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
import { DeleteKroniqImageResponseDto } from './dto/delete-kroniq-image-response.dto';
import { KroniqImageResponseDto } from './dto/kroniq-image-response.dto';
import { KroniqService } from './kroniq.service';

@ApiTags('Kroniq')
@Controller('kroniq')
export class KroniqController {
    constructor(private readonly kroniqService: KroniqService) {}

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
    @Delete('me/photo')
    @ApiOperation({ summary: 'Delete current user KroniQ image' })
    @ApiOkResponse({ type: DeleteKroniqImageResponseDto })
    async deletePhoto(@Req() req: any) {
        return this.kroniqService.deletePhoto(req.user.sub);
    }
}
