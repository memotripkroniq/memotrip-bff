import {
    assertSafeSeedEnvironment,
    buildSeedTripData,
    buildSeedTripName,
    getSeedCliUsage,
    isManagedSeedTrip,
    parseSeedCliArgs,
    TRIP_LIMIT_SEED_FROM,
    TRIP_LIMIT_SEED_NAME_PREFIX,
    TRIP_LIMIT_SEED_THEME,
    TRIP_LIMIT_SEED_TO,
} from './trip-limit-seed';

describe('trip-limit-seed helpers', () => {
    it('parses target-trip arguments', () => {
        expect(
            parseSeedCliArgs([
                '--email=Test@Example.com',
                '--trips=30',
            ]),
        ).toEqual({
            email: 'test@example.com',
            trips: 30,
            cleanup: false,
        });
    });

    it('parses cleanup arguments', () => {
        expect(
            parseSeedCliArgs([
                '--email=test@example.com',
                '--cleanup',
            ]),
        ).toEqual({
            email: 'test@example.com',
            trips: null,
            cleanup: true,
        });
    });

    it('rejects invalid argument combinations', () => {
        expect(() => parseSeedCliArgs(['--email=test@example.com'])).toThrow(
            'Provide either --trips=<n> or --cleanup',
        );
        expect(() =>
            parseSeedCliArgs(['--email=test@example.com', '--cleanup', '--trips=1']),
        ).toThrow('Use either --cleanup or --trips=<n>, not both');
    });

    it('rejects production environments', () => {
        expect(() =>
            assertSafeSeedEnvironment({ NODE_ENV: 'production' }),
        ).toThrow('Refusing to run test-user seed against a production environment');
    });

    it('builds deterministic managed trip names and markers', () => {
        expect(buildSeedTripName(0)).toBe(`${TRIP_LIMIT_SEED_NAME_PREFIX} Trip 001`);
        expect(
            isManagedSeedTrip({
                name: buildSeedTripName(1),
                from: TRIP_LIMIT_SEED_FROM,
                to: TRIP_LIMIT_SEED_TO,
                theme: TRIP_LIMIT_SEED_THEME,
            }),
        ).toBe(true);
    });

    it('places seeded createdAt values inside the current trip-limit window', () => {
        const now = new Date('2026-08-16T11:15:00.000Z');
        const trips = buildSeedTripData('user-1', 3, now);

        expect(trips).toHaveLength(3);
        expect(trips[0].createdAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
        expect(trips[1].createdAt).toEqual(new Date('2026-08-01T00:01:00.000Z'));
        expect(trips[2].createdAt).toEqual(new Date('2026-08-01T00:02:00.000Z'));
    });

    it('exposes usage text', () => {
        expect(getSeedCliUsage()).toContain('npm run seed:test-user');
    });
});
