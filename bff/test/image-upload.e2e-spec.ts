import { BadRequestException, Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { imageUploadOptions } from '../src/common/upload/image-upload-options';

const request = require('supertest');

@Controller('uploads')
class TestImageUploadController {
    @Post('image')
    @UseInterceptors(FileInterceptor('file', imageUploadOptions(8)))
    uploadImage(@UploadedFile() file?: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException("Missing file field (multipart name must be 'file')");
        }

        return {
            mimetype: file.mimetype,
        };
    }
}

describe('Image upload validation (e2e)', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [TestImageUploadController],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('accepts JPEG uploads', async () => {
        await request(app.getHttpServer())
            .post('/uploads/image')
            .attach('file', Buffer.from([1, 2, 3, 4]), {
                filename: 'photo.jpg',
                contentType: 'image/jpeg',
            })
            .expect(201)
            .expect({ mimetype: 'image/jpeg' });
    });

    it('accepts PNG uploads', async () => {
        await request(app.getHttpServer())
            .post('/uploads/image')
            .attach('file', Buffer.from([1, 2, 3, 4]), {
                filename: 'photo.png',
                contentType: 'image/png',
            })
            .expect(201)
            .expect({ mimetype: 'image/png' });
    });

    it('rejects image/webp with HTTP 400', async () => {
        const response = await request(app.getHttpServer())
            .post('/uploads/image')
            .attach('file', Buffer.from([1, 2, 3, 4]), {
                filename: 'photo.webp',
                contentType: 'image/webp',
            })
            .expect(400);

        expect(response.body.message).toBe('Only PNG and JPEG images are allowed');
    });

    it('rejects text/plain with HTTP 400', async () => {
        const response = await request(app.getHttpServer())
            .post('/uploads/image')
            .attach('file', Buffer.from([1, 2, 3, 4]), {
                filename: 'note.txt',
                contentType: 'text/plain',
            })
            .expect(400);

        expect(response.body.message).toBe('Only PNG and JPEG images are allowed');
    });

    it('maps oversized files to HTTP 413', async () => {
        const response = await request(app.getHttpServer())
            .post('/uploads/image')
            .attach('file', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), {
                filename: 'photo.jpg',
                contentType: 'image/jpeg',
            })
            .expect(413);

        expect(response.body.message).toBe('File too large');
    });

    it('keeps missing file as HTTP 400', async () => {
        const response = await request(app.getHttpServer())
            .post('/uploads/image')
            .field('other', 'value')
            .expect(400);

        expect(response.body.message).toBe("Missing file field (multipart name must be 'file')");
    });
});
