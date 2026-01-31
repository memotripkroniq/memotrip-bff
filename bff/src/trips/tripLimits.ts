import { PrismaClient } from "@prisma/client";

type PlanKey = "FREE" | "PREMIUM" | "KRONIQ";

const PLAN_POLICY: Record<PlanKey, { limit: number; windowDays: number }> = {
    FREE: { limit: 1, windowDays: 90 },
    PREMIUM: { limit: 3, windowDays: 30 },
    KRONIQ: { limit: 30, windowDays: 365 },
};

function getPlanFromUser(user: { isPremium: boolean; isKroniq: boolean }): PlanKey {
    if (user.isKroniq) return "KRONIQ";
    if (user.isPremium) return "PREMIUM";
    return "FREE";
}

export async function canCreateTrip(prisma: PrismaClient, userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true, isKroniq: true },
    });

    const plan = user ? getPlanFromUser(user) : "FREE";
    const { limit, windowDays } = PLAN_POLICY[plan];

    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const used = await prisma.trips.count({
        where: {
            ownerId: userId,
            createdAt: { gte: windowStart },
        },
    });

    return {
        allowed: used < limit,
        plan,
        used,
        limit,
        windowDays,
        windowStart,
    };
}
