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
