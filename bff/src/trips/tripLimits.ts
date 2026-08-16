type TripPlan = 'free' | 'premium' | 'kroniq';
type TripLimitCode = 'TRIP_LIMIT_OK' | 'TRIP_LIMIT_REACHED';

type TripPolicy = {
    limit: number | null;
    windowDays: number;
};

type UserPlanFlags = {
    isPremium: boolean;
    isKroniq: boolean;
};

type TripLimitPrisma = {
    user: {
        findUnique(args: {
            where: { id: string };
            select: { isPremium: true; isKroniq: true };
        }): Promise<UserPlanFlags | null>;
    };
    trips: {
        count(args: {
            where: {
                ownerId: string;
                createdAt: { gte: Date };
            };
        }): Promise<number>;
    };
};

export type TripLimitStatus = {
    allowed: boolean;
    code: TripLimitCode;
    plan: TripPlan;
    used: number;
    limit: number | null;
    windowDays: number;
    windowStart: Date;
};

export const TRIP_LIMIT_WINDOW_DAYS = 30;

export const TRIP_PLAN_POLICY: Record<TripPlan, TripPolicy> = {
    free: { limit: 1, windowDays: TRIP_LIMIT_WINDOW_DAYS },
    premium: { limit: 3, windowDays: TRIP_LIMIT_WINDOW_DAYS },
    kroniq: { limit: null, windowDays: TRIP_LIMIT_WINDOW_DAYS },
};

export function getTripPlanFromUser(user: UserPlanFlags): TripPlan {
    if (user.isKroniq) {
        return 'kroniq';
    }

    if (user.isPremium) {
        return 'premium';
    }

    return 'free';
}

export function getTripLimitWindowStart(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function getTripLimitStatus(
    prisma: TripLimitPrisma,
    userId: string,
    now = new Date(),
): Promise<TripLimitStatus> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true, isKroniq: true },
    });

    const plan = user ? getTripPlanFromUser(user) : 'free';
    const policy = TRIP_PLAN_POLICY[plan];
    const windowStart = getTripLimitWindowStart(now);

    const used = await prisma.trips.count({
        where: {
            ownerId: userId,
            createdAt: { gte: windowStart },
        },
    });

    const allowed = policy.limit === null ? true : used < policy.limit;

    return {
        allowed,
        code: allowed ? 'TRIP_LIMIT_OK' : 'TRIP_LIMIT_REACHED',
        plan,
        used,
        limit: policy.limit,
        windowDays: policy.windowDays,
        windowStart,
    };
}
