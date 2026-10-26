import { TripsService } from './trips.service';
import { TransportType, DestinationType } from './dto/trip.enums';

describe('TripsService', () => {
    const createDto = {
        name: 'Test trip',
        destination: DestinationType.EUROPE,
        dateFrom: '2026-04-22',
        dateTo: '2026-04-25',
        from: 'Bratislava',
        to: 'Barcelona',
        transport: TransportType.CAR,
        mapImageUrl: 'https://cdn.memotrip.app/trips/maps/test.webp',
    };

    function createService(prismaOverrides?: Partial<any>) {
        const prisma = {
            $executeRaw: jest.fn().mockResolvedValue(0),
            $queryRaw: jest.fn().mockResolvedValue([{ now: new Date('2026-04-22T12:00:00Z') }]),
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: false,
                    isKroniq: false,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({
                    id: 'trip-1',
                    name: createDto.name,
                    createdAt: new Date('2026-04-22T12:00:00.000Z'),
                    coverImageUrl: null,
                    mapImageUrl: createDto.mapImageUrl,
                    mapImageFullUrl: null,
                }),
            },
            ...prismaOverrides,
        };

        (prisma as any).$transaction = jest.fn(callback => callback(prisma));
        const service = new TripsService(prisma as any, {} as any);
        return { service, prisma };
    }

    it('rejects createTrip when the limit is reached', async () => {
        const { service, prisma } = createService({
            trips: {
                count: jest.fn().mockResolvedValue(1),
                create: jest.fn(),
            },
        });

        await expect(service.createTrip('user-1', createDto as any)).rejects.toMatchObject({
            response: {
                code: 'TRIP_LIMIT_REACHED',
                plan: 'free',
                used: 1,
                limit: 1,
                windowDays: 30,
                message: 'Trip creation limit reached for the current billing window',
            },
        });

        expect(prisma.trips.create).not.toHaveBeenCalled();
    });

    it('creates a trip when the limit allows it', async () => {
        const { service, prisma } = createService();

        await expect(service.createTrip('user-1', createDto as any)).resolves.toMatchObject({
            id: 'trip-1',
            name: createDto.name,
            mapImageUrl: createDto.mapImageUrl,
        });

        expect(prisma.trips.create).toHaveBeenCalled();
    });

    it('uses one transaction, a post-lock UTC clock and explicit transaction options', async () => {
        const { service, prisma } = createService();
        const instant = new Date('2026-05-01T00:00:00Z');
        prisma.$queryRaw.mockResolvedValueOnce([{ lock: '' }]).mockResolvedValueOnce([{ now: instant }]);
        await service.createTrip('user-1', createDto as any);
        expect((prisma as any).$transaction).toHaveBeenCalledWith(expect.any(Function), {
            isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 5000,
        });
        expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock(1297372250');
        expect(prisma.$queryRaw.mock.calls[0][1]).toBe('user-1');
        expect(prisma.$executeRaw.mock.calls[0][0].join('')).toContain("SET LOCAL lock_timeout = '2s'");
        expect(prisma.trips.count).toHaveBeenCalledWith({ where: {
            ownerId: 'user-1', createdAt: { gte: instant },
        } });
        expect(prisma.trips.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ createdAt: instant }),
        }));
        expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(prisma.trips.count.mock.invocationCallOrder[0]);
    });

    it('does not turn lock timeout or database failures into a limit rejection', async () => {
        const { service, prisma } = createService();
        const failure = new Error('database timeout');
        prisma.$queryRaw.mockRejectedValueOnce(failure);
        await expect(service.createTrip('user-1', createDto as any)).rejects.toBe(failure);
        expect(prisma.trips.create).not.toHaveBeenCalled();
    });

    it('creates a trip for kroniq users even when they already have many trips', async () => {
        const { service, prisma } = createService({
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    isPremium: true,
                    isKroniq: true,
                }),
            },
            trips: {
                count: jest.fn().mockResolvedValue(30),
                create: jest.fn().mockResolvedValue({
                    id: 'trip-1',
                    name: createDto.name,
                    createdAt: new Date('2026-04-22T12:00:00.000Z'),
                    coverImageUrl: null,
                    mapImageUrl: createDto.mapImageUrl,
                    mapImageFullUrl: null,
                }),
            },
        });

        await expect(service.createTrip('user-1', createDto as any)).resolves.toMatchObject({
            id: 'trip-1',
            name: createDto.name,
        });

        expect(prisma.trips.create).toHaveBeenCalled();
    });

    it('rejects photo upload when the free photo limit is reached', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn()
                    .mockResolvedValueOnce({ isPremium: false, isKroniq: false })
                    .mockResolvedValueOnce({ isPremium: false, isKroniq: false }),
            },
            trips: {
                findFirst: jest.fn().mockResolvedValue({ id: 'trip-1' }),
            },
            tripPhoto: {
                count: jest.fn().mockResolvedValue(30),
            },
        };

        const service = new TripsService(prisma as any, {} as any);

        await expect(
            service.uploadTripPhoto(
                'user-1',
                'trip-1',
                {
                    mimetype: 'image/png',
                    buffer: Buffer.from('x'),
                    originalname: 'a.png',
                } as any,
            ),
        ).rejects.toMatchObject({
            response: {
                code: 'TRIP_PHOTO_LIMIT_REACHED',
                message: 'Trip photo upload limit reached for the current plan',
                plan: 'free',
                used: 30,
                limit: 30,
            },
        });
    });
});
