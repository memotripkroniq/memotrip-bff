import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '../prisma/generated/prisma';
import {
    assertSafeSeedEnvironment,
    buildSeedTripData,
    getSeedCliUsage,
    parseSeedCliArgs,
    TRIP_LIMIT_SEED_FROM,
    TRIP_LIMIT_SEED_NAME_PREFIX,
    TRIP_LIMIT_SEED_THEME,
    TRIP_LIMIT_SEED_TO,
} from '../src/testing/trip-limit-seed';
import { getTripLimitWindowStart } from '../src/trips/tripLimits';

function loadLocalEnvFile() {
    const envPath = resolve(process.cwd(), '.env');

    if (!existsSync(envPath)) {
        return;
    }

    const content = readFileSync(envPath, 'utf8');

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key || process.env[key] !== undefined) {
            continue;
        }

        let value = line.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

async function main() {
    if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
        console.log(getSeedCliUsage());
        return;
    }

    loadLocalEnvFile();
    assertSafeSeedEnvironment(process.env);

    const options = parseSeedCliArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        await prisma.$connect();

        const user = await prisma.user.findFirst({
            where: {
                email: options.email,
                deletedAt: null,
            },
            select: {
                id: true,
                email: true,
            },
        });

        if (!user) {
            throw new Error(`User not found for email ${options.email}`);
        }

        const existingSeedTrips = await prisma.trips.findMany({
            where: {
                ownerId: user.id,
                name: {
                    startsWith: TRIP_LIMIT_SEED_NAME_PREFIX,
                },
                from: TRIP_LIMIT_SEED_FROM,
                to: TRIP_LIMIT_SEED_TO,
                theme: TRIP_LIMIT_SEED_THEME,
            },
            select: {
                id: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        const managedSeedTripIds = existingSeedTrips.map((trip) => trip.id);

        const windowStart = getTripLimitWindowStart();

        const relevantNonSeedTripsBefore = await prisma.trips.count({
            where: {
                ownerId: user.id,
                createdAt: {
                    gte: windowStart,
                },
                NOT: {
                    AND: [
                        {
                            name: {
                                startsWith: TRIP_LIMIT_SEED_NAME_PREFIX,
                            },
                        },
                        {
                            from: TRIP_LIMIT_SEED_FROM,
                        },
                        {
                            to: TRIP_LIMIT_SEED_TO,
                        },
                        {
                            theme: TRIP_LIMIT_SEED_THEME,
                        },
                    ],
                },
            },
        });

        if (options.cleanup) {
            const deletedCount = managedSeedTripIds.length === 0
                ? 0
                : (
                    await prisma.trips.deleteMany({
                        where: {
                            id: {
                                in: managedSeedTripIds,
                            },
                        },
                    })
                ).count;

            console.log(
                JSON.stringify(
                    {
                        success: true,
                        mode: 'cleanup',
                        email: user.email,
                        deletedSeedTrips: deletedCount,
                    },
                    null,
                    2,
                ),
            );
            return;
        }

        const seedTrips = buildSeedTripData(user.id, options.trips ?? 0);
        const deletedCount = await prisma.$transaction(async (tx) => {
            const deleted = managedSeedTripIds.length === 0
                ? 0
                : (
                    await tx.trips.deleteMany({
                        where: {
                            id: {
                                in: managedSeedTripIds,
                            },
                        },
                    })
                ).count;

            if (seedTrips.length > 0) {
                await tx.trips.createMany({
                    data: seedTrips,
                });
            }

            return deleted;
        });

        const relevantSeedTrips = await prisma.trips.count({
            where: {
                ownerId: user.id,
                createdAt: {
                    gte: windowStart,
                },
                name: {
                    startsWith: TRIP_LIMIT_SEED_NAME_PREFIX,
                },
                from: TRIP_LIMIT_SEED_FROM,
                to: TRIP_LIMIT_SEED_TO,
                theme: TRIP_LIMIT_SEED_THEME,
            },
        });

        console.log(
            JSON.stringify(
                {
                    success: true,
                    mode: 'seed',
                    email: user.email,
                    deletedSeedTrips: deletedCount,
                    createdSeedTrips: seedTrips.length,
                    relevantSeedTrips,
                    relevantNonSeedTripsBefore,
                    expectedRelevantTotalAfterSeed: relevantNonSeedTripsBefore + relevantSeedTrips,
                    usage: getSeedCliUsage(),
                },
                null,
                2,
            ),
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
