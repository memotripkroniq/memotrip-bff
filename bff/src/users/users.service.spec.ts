import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { userResponseSelect } from './dto/user-response.dto';
import * as bcrypt from 'bcryptjs';

describe('UsersService privacy', () => {
    const safe = { id: 'user-a', email: 'a@example.com', name: 'A', country: 'EN' };
    const prisma = { user: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() } };
    const service = new UsersService(prisma as unknown as PrismaService);
    let record: object;
    beforeEach(async () => {
        jest.clearAllMocks();
        record = { ...safe, passwordhash: await bcrypt.hash('password123', 4), providerId: 'private-id', deletedAt: null };
    });

    it('selects and serializes only public fields on creation', async () => {
        prisma.user.create.mockResolvedValue(record);
        expect(await service.createUser({ email: safe.email, password: 'password123', name: 'A', country: 'EN' })).toEqual(safe);
        const args = prisma.user.create.mock.calls[0][0];
        expect(args.select).toEqual(userResponseSelect);
        expect(args.data.passwordhash).not.toBe('password123');
        expect(await bcrypt.compare('password123', args.data.passwordhash)).toBe(true);
    });

    it('scopes reads to the active authenticated account', async () => {
        prisma.user.findMany.mockResolvedValue([record]);
        expect(await service.findAll(safe.id)).toEqual([safe]);
        expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: safe.id, deletedAt: null }, select: userResponseSelect });
    });

    it('fails closed when identity is missing instead of omitting the Prisma filter', async () => {
        await expect(service.findAll(undefined as unknown as string)).rejects.toMatchObject({ status: 401 });
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('never returns credentials or logs a user during successful login', async () => {
        prisma.user.findFirst.mockResolvedValue(record);
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            expect(await service.validateUser(safe.email, 'password123')).toEqual(safe);
            expect(log).not.toHaveBeenCalled();
            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: { email: safe.email, deletedAt: null },
                select: { ...userResponseSelect, passwordhash: true },
            });
        } finally { log.mockRestore(); }
    });

    it('rejects incorrect passwords, missing accounts and Google-only accounts', async () => {
        prisma.user.findFirst.mockResolvedValue(record);
        expect(await service.validateUser(safe.email, 'wrong')).toBeNull();
        prisma.user.findFirst.mockResolvedValue(null);
        expect(await service.validateUser(safe.email, 'password123')).toBeNull();
        prisma.user.findFirst.mockResolvedValue({ ...safe, passwordhash: null });
        expect(await service.validateUser(safe.email, 'password123')).toBeNull();
    });
});
