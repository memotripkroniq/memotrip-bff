import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import type { Options } from 'multer';

const MEGABYTE = 1024 * 1024;

export const PROFILE_IMAGE_MAX_FILE_SIZE = 5 * MEGABYTE;
export const KRONIQ_IMAGE_MAX_FILE_SIZE = 5 * MEGABYTE;
export const TRIP_COVER_MAX_FILE_SIZE = 10 * MEGABYTE;
export const TRIP_GALLERY_IMAGE_MAX_FILE_SIZE = 12 * MEGABYTE;

export const IMAGE_UPLOAD_UNSUPPORTED_TYPE_MESSAGE = 'Only PNG and JPEG images are allowed';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
]);

export function imageUploadOptions(maxFileSize: number): Options {
    return {
        storage: memoryStorage(),
        limits: {
            fileSize: maxFileSize,
        },
        fileFilter: (_req, file, callback) => {
            if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
                return callback(null, true);
            }

            return (callback as (error: Error, acceptFile: boolean) => void)(
                new BadRequestException(IMAGE_UPLOAD_UNSUPPORTED_TYPE_MESSAGE),
                false,
            );
        },
    };
}
