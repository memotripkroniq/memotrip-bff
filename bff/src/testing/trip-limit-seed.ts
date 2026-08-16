import { getTripLimitWindowStart } from '../trips/tripLimits';

export const TRIP_LIMIT_SEED_NAME_PREFIX = '[TEST-SEED][TRIP-LIMIT]';
export const TRIP_LIMIT_SEED_FROM = '__TEST_SEED_FROM__';
export const TRIP_LIMIT_SEED_TO = '__TEST_SEED_TO__';
export const TRIP_LIMIT_SEED_THEME = '__TEST_SEED_THEME__';
export const TRIP_LIMIT_SEED_DESTINATION = 'EUROPE';
export const TRIP_LIMIT_SEED_TRANSPORT = 'CAR';

export type SeedCliOptions = {
    email: string;
    trips: number | null;
    cleanup: boolean;
};

export function parseSeedCliArgs(argv: string[]): SeedCliOptions {
    let email: string | null = null;
    let trips: number | null = null;
    let cleanup = false;

    for (const arg of argv) {
        if (arg.startsWith('--email=')) {
            email = arg.slice('--email='.length).trim().toLowerCase();
            continue;
        }

        if (arg.startsWith('--trips=')) {
            const rawValue = arg.slice('--trips='.length).trim();
            const parsed = Number(rawValue);

            if (!Number.isInteger(parsed) || parsed < 0) {
                throw new Error('--trips must be a non-negative integer');
            }

            trips = parsed;
            continue;
        }

        if (arg === '--cleanup') {
            cleanup = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            throw new Error(getSeedCliUsage());
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (!email) {
        throw new Error('--email is required');
    }

    if (!cleanup && trips === null) {
        throw new Error('Provide either --trips=<n> or --cleanup');
    }

    if (cleanup && trips !== null) {
        throw new Error('Use either --cleanup or --trips=<n>, not both');
    }

    return {
        email,
        trips,
        cleanup,
    };
}

export function getSeedCliUsage(): string {
    return [
        'Usage:',
        '  npm run seed:test-user -- --email=test@example.com --trips=30',
        '  npm run seed:test-user -- --email=test@example.com --cleanup',
    ].join('\n');
}

export function assertSafeSeedEnvironment(env: NodeJS.ProcessEnv): void {
    const productionFlags = [
        env.NODE_ENV,
        env.APP_ENV,
        env.RAILWAY_ENVIRONMENT,
        env.RAILWAY_ENVIRONMENT_NAME,
        env.RAILWAY_DEPLOYMENT_ENVIRONMENT,
        env.VERCEL_ENV,
    ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());

    if (productionFlags.some((value) => value === 'production' || value === 'prod')) {
        throw new Error('Refusing to run test-user seed against a production environment');
    }
}

export function buildSeedTripName(index: number): string {
    return `${TRIP_LIMIT_SEED_NAME_PREFIX} Trip ${String(index + 1).padStart(3, '0')}`;
}

export function isManagedSeedTrip(trip: {
    name: string;
    from: string;
    to: string;
    theme: string | null;
}): boolean {
    return (
        trip.name.startsWith(TRIP_LIMIT_SEED_NAME_PREFIX) &&
        trip.from === TRIP_LIMIT_SEED_FROM &&
        trip.to === TRIP_LIMIT_SEED_TO &&
        trip.theme === TRIP_LIMIT_SEED_THEME
    );
}

export function buildSeedTripData(ownerId: string, count: number, now = new Date()) {
    const windowStart = getTripLimitWindowStart(now);
    const baseTripDate = new Date(windowStart.getTime());
    baseTripDate.setUTCDate(baseTripDate.getUTCDate() + 7);

    return Array.from({ length: count }, (_, index) => {
        const createdAt = new Date(windowStart.getTime() + index * 60_000);

        return {
            ownerId,
            name: buildSeedTripName(index),
            destination: TRIP_LIMIT_SEED_DESTINATION,
            transport: TRIP_LIMIT_SEED_TRANSPORT,
            from: TRIP_LIMIT_SEED_FROM,
            to: TRIP_LIMIT_SEED_TO,
            waypoints: [] as string[],
            startDate: baseTripDate,
            endDate: baseTripDate,
            theme: TRIP_LIMIT_SEED_THEME,
            plannedBudget: null,
            spentBudget: null,
            coverImageUrl: null,
            mapImageUrl: null,
            mapImageFullUrl: null,
            isSharedInKroniQ: false,
            createdAt,
        };
    });
}
