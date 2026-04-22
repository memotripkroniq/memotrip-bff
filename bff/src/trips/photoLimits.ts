type PhotoPlan = 'free' | 'premium' | 'kroniq';
type PhotoLimitCode = 'TRIP_PHOTO_LIMIT_OK' | 'TRIP_PHOTO_LIMIT_REACHED';

type UserPlanFlags = {
    isPremium: boolean;
    isKroniq: boolean;
};

type PhotoLimitPrisma = {
    user: {
        findUnique(args: {
            where: { id: string };
            select: { isPremium: true; isKroniq: true };
        }): Promise<UserPlanFlags | null>;
    };
    tripPhoto: {
        count(args: {
            where: { tripId: string };
        }): Promise<number>;
    };
};

export type TripPhotoLimitStatus = {
    allowed: boolean;
    code: PhotoLimitCode;
    plan: PhotoPlan;
    used: number;
    limit: number | null;
};

const PHOTO_PLAN_LIMITS: Record<PhotoPlan, number | null> = {
    free: 30,
    premium: 100,
    kroniq: null,
};

function getPhotoPlanFromUser(user: UserPlanFlags): PhotoPlan {
    if (user.isKroniq) {
        return 'kroniq';
    }

    if (user.isPremium) {
        return 'premium';
    }

    return 'free';
}

export async function getTripPhotoLimitStatus(
    prisma: PhotoLimitPrisma,
    ownerId: string,
    tripId: string,
): Promise<TripPhotoLimitStatus> {
    const user = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { isPremium: true, isKroniq: true },
    });

    const plan = user ? getPhotoPlanFromUser(user) : 'free';
    const limit = PHOTO_PLAN_LIMITS[plan];
    const used = await prisma.tripPhoto.count({
        where: { tripId },
    });
    const allowed = limit === null ? true : used < limit;

    return {
        allowed,
        code: allowed ? 'TRIP_PHOTO_LIMIT_OK' : 'TRIP_PHOTO_LIMIT_REACHED',
        plan,
        used,
        limit,
    };
}
