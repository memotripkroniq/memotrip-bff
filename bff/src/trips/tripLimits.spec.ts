import {
    getTripLimitStatus,
    getTripLimitWindowStart,
} from './tripLimits';

describe('tripLimits', () => {
    const now = new Date('2026-04-22T10:30:00.000Z');

    it('returns free plan with one-trip limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(0),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result).toEqual({
            allowed: true,
            code: 'TRIP_LIMIT_OK',
            plan: 'free',
            used: 0,
            limit: 1,
            windowDays: 30,
            windowStart: new Date('2026-04-01T00:00:00.000Z'),
        });
    });

    it('blocks free users once they hit the limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(1),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('TRIP_LIMIT_REACHED');
        expect(result.limit).toBe(1);
    });

    it('allows premium users below the limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(2),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result.allowed).toBe(true);
        expect(result.plan).toBe('premium');
        expect(result.limit).toBe(3);
    });

    it('blocks premium users at the limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(3),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result.allowed).toBe(false);
        expect(result.plan).toBe('premium');
        expect(result.limit).toBe(3);
    });

    it('allows kroniq users below the limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: true,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(29),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result.allowed).toBe(true);
        expect(result.plan).toBe('kroniq');
        expect(result.limit).toBe(30);
    });

    it('blocks kroniq users at the limit', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: true,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(30),
            },
        };

        const result = await getTripLimitStatus(prisma, 'user-1', now);

        expect(result.allowed).toBe(false);
        expect(result.plan).toBe('kroniq');
        expect(result.limit).toBe(30);
    });

    it('counts trips from the start of the current UTC month', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(0),
            },
        };

        await getTripLimitStatus(prisma, 'user-1', now);

        expect(prisma.trips.count).toHaveBeenCalledWith({
            where: {
                ownerId: 'user-1',
                createdAt: { gte: new Date('2026-04-01T00:00:00.000Z') },
            },
        });
    });

    it('computes the monthly window start in UTC', () => {
        expect(getTripLimitWindowStart(now)).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    });
});
