import { getTripPhotoLimitStatus } from './photoLimits';

describe('photoLimits', () => {
    it('allows free users below the photo limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(29),
            },
        };

        const result = await getTripPhotoLimitStatus(prisma, 'user-1', 'trip-1');

        expect(result).toEqual({
            allowed: true,
            code: 'TRIP_PHOTO_LIMIT_OK',
            plan: 'free',
            used: 29,
            limit: 30,
        });
    });

    it('blocks free users at the photo limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(30),
            },
        };

        const result = await getTripPhotoLimitStatus(prisma, 'user-1', 'trip-1');

        expect(result.allowed).toBe(false);
        expect(result.limit).toBe(30);
    });

    it('allows premium users below the photo limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: false,
                }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(99),
            },
        };

        const result = await getTripPhotoLimitStatus(prisma, 'user-1', 'trip-1');

        expect(result.allowed).toBe(true);
        expect(result.plan).toBe('premium');
        expect(result.limit).toBe(100);
    });

    it('blocks premium users at the photo limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: false,
                }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(100),
            },
        };

        const result = await getTripPhotoLimitStatus(prisma, 'user-1', 'trip-1');

        expect(result.allowed).toBe(false);
        expect(result.limit).toBe(100);
    });

    it('returns unlimited for kroniq users', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: true,
                }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(999),
            },
        };

        const result = await getTripPhotoLimitStatus(prisma, 'user-1', 'trip-1');

        expect(result).toEqual({
            allowed: true,
            code: 'TRIP_PHOTO_LIMIT_OK',
            plan: 'kroniq',
            used: 999,
            limit: null,
        });
    });
});
