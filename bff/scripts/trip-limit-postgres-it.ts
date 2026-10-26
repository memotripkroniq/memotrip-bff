// Synthetic local PostgreSQL only; run through run-trip-limit-postgres-it.ps1.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { TripsService } from '../src/trips/trips.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { getTripLimitStatus } from '../src/trips/tripLimits';

const url = process.env.DUMMYPAY_IT_URL;
if (!url || process.env.DUMMYPAY_IT_MARKER !== 'MEMOTRIP_DUMMYPAY_ISOLATED_IT') throw new Error('Isolated test marker required');
const destination = new URL(url);
if (destination.hostname !== '127.0.0.1' || destination.port !== process.env.DUMMYPAY_IT_PORT ||
    destination.pathname !== `/${process.env.DUMMYPAY_IT_DATABASE}` ||
    !/^\/dummypay_it_[a-f0-9]{32}$/.test(destination.pathname)) throw new Error('Unsafe test database');
const [a, b, observer] = Array.from({ length: 3 }, () => new PrismaClient({ datasources: { db: { url } } }));
const users: string[] = [];
const dto = { name: 'Atomic limit test', destination: 'EUROPE', transport: 'CAR', from: 'A', to: 'B', dateFrom: '2026-01-01', dateTo: '2026-01-02' };
function gate() { let open!: () => void; const promise = new Promise<void>(r => { open = r; }); return { promise, open }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Barrier timeout')), 10000); })]); }
    finally { clearTimeout(timer); }
}
type Hooks = { pid?: number; afterLock?: () => Promise<void>; beforeLock?: () => void; rollback?: boolean; clock?: Date; lockTimeout?: boolean; realClock?: Date };
function instrument(client: PrismaClient, hooks: Hooks) {
    return new Proxy(client, { get(target, key) {
        if (key !== '$transaction') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
        return (callback: (tx: any) => Promise<any>, options: any) => {
            assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
            return target.$transaction(async tx => {
                const [identity] = await tx.$queryRaw<Array<{ pid: number; isolation: string }>>`SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation`;
                hooks.pid = identity.pid;
                assert.equal(identity.isolation, 'read committed');
                return callback(new Proxy(tx, { get(transaction, property) {
                    if (property === '$queryRaw') return async (sql: TemplateStringsArray, ...values: any[]) => {
                        const locking = sql.join('').includes('pg_advisory_xact_lock');
                        if (locking && hooks.lockTimeout) await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
                        if (locking) hooks.beforeLock?.();
                        const result = await (transaction.$queryRaw as any)(sql, ...values);
                        if (locking) await hooks.afterLock?.();
                        if (sql.join('').includes('clock_timestamp')) {
                            hooks.realClock = result[0].now;
                            // Only the boundary clock is controlled; locks/counts/inserts remain real PostgreSQL.
                            if (hooks.clock) return [{ now: hooks.clock }];
                        }
                        return result;
                    };
                    if (property === 'trips' && hooks.rollback) return new Proxy(transaction.trips, { get(delegate, method) {
                        if (method === 'create') return async (args: any) => { await delegate.create(args); throw new Error('INJECTED_ROLLBACK'); };
                        const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
                    } });
                    const value = Reflect.get(transaction, property); return typeof value === 'function' ? value.bind(transaction) : value;
                } }));
            }, options);
        };
    } }) as PrismaService;
}
function service(client: PrismaClient, hooks: Hooks = {}) { return new TripsService(instrument(client, hooks), {} as any); }
function settle(p: Promise<any>) { return p.then(value => ({ value, error: undefined }), error => ({ value: undefined, error })); }
async function blocked(waiter: Hooks, holder: Hooks) {
    assert.notEqual(waiter.pid, holder.pid);
    const end = Date.now() + 3000;
    while (Date.now() < end) {
        const [row] = await observer.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${holder.pid!}::int = ANY(pg_blocking_pids(${waiter.pid!}::int)) AS blocked`;
        if (row.blocked) return;
        await new Promise(r => setTimeout(r, 5)); // Observe actual DB lock, never infer ordering from delay.
    }
    throw new Error('Expected lock wait not observed');
}
async function fixture(plan: 'free' | 'premium' | 'kroniq', count: number) {
    const user = await a.user.create({ data: { email: `trip-it-${randomUUID()}@invalid.test`, isPremium: plan === 'premium', isKroniq: plan === 'kroniq' } });
    users.push(user.id);
    if (count) await a.trips.createMany({ data: Array.from({ length: count }, () => ({ ownerId: user.id, name: dto.name, destination: dto.destination, transport: dto.transport, from: dto.from, to: dto.to, startDate: new Date(dto.dateFrom), endDate: new Date(dto.dateTo) })) });
    return user;
}
let passed = 0;
function ok(label: string) { console.log(`PASS ${++passed}: ${label}`); }
async function race(plan: 'free' | 'premium' | 'kroniq', count: number, reverse = false, rollback = false) {
    const user = await fixture(plan, count);
    const locked = gate(), release = gate(), attempting = gate();
    const first: Hooks = { afterLock: async () => { locked.open(); await release.promise; }, rollback };
    const second: Hooks = { beforeLock: attempting.open };
    const p = settle(service(reverse ? b : a, first).createTrip(user.id, dto as any));
    let q: ReturnType<typeof settle> | undefined;
    try {
        await bounded(locked.promise);
        q = settle(service(reverse ? a : b, second).createTrip(user.id, dto as any));
        await bounded(attempting.promise); await blocked(second, first);
    } finally { release.open(); }
    const results = await Promise.all([p, q!]);
    const successes = results.filter(r => r.value);
    const expected = rollback ? 1 : plan === 'kroniq' ? 2 : count === 3 ? 0 : 1;
    assert.equal(successes.length, expected);
    for (const r of results.filter(r => r.error)) {
        if (rollback && r === results[0]) assert.equal(r.error.message, 'INJECTED_ROLLBACK');
        else { assert.equal(r.error.getStatus(), 403); assert.equal(r.error.getResponse().code, 'TRIP_LIMIT_REACHED'); }
    }
    assert.equal(await observer.trips.count({ where: { ownerId: user.id } }), count + expected);
    for (const r of successes) assert.deepEqual(Object.keys(r.value).sort(), ['id', 'name', 'createdAt', 'coverImageUrl', 'mapImageUrl', 'mapImageFullUrl'].sort());
    const current = await observer.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(current.isPremium, user.isPremium); assert.equal(current.isKroniq, user.isKroniq);
    ok(`${plan} ${count}, reverse=${reverse}, rollback=${rollback}`);
}
async function differentUsers() {
    const u = await fixture('premium', 2), v = await fixture('premium', 2);
    const locked = gate(), release = gate();
    let firstSettled = false;
    const first = settle(service(a, { afterLock: async () => { locked.open(); await release.promise; } }).createTrip(u.id, dto as any))
        .then(result => { firstSettled = true; return result; });
    try {
        await bounded(locked.promise); await bounded(service(b).createTrip(v.id, dto as any));
        assert.equal(firstSettled, false, 'Other user must finish while first transaction still owns its lock');
    } finally { release.open(); assert(!(await first).error); }
    assert.equal(await observer.trips.count({ where: { ownerId: v.id } }), 3);
    ok('different users progress while first lock remains held');
}
async function timeout() {
    const u = await fixture('premium', 2), locked = gate(), release = gate(), attempting = gate();
    const holder: Hooks = { afterLock: async () => { locked.open(); await release.promise; } };
    const waiter: Hooks = { lockTimeout: true, beforeLock: attempting.open };
    const first = settle(service(a, holder).createTrip(u.id, dto as any));
    try {
        await bounded(locked.promise);
        const second = settle(service(b, waiter).createTrip(u.id, dto as any));
        await bounded(attempting.promise); await blocked(waiter, holder);
        const result = await bounded(second);
        assert(result.error); assert.notEqual(result.error.getStatus?.(), 403);
        assert.equal(result.error.meta?.code, '55P03');
    } finally { release.open(); await first; }
    assert.equal(await observer.trips.count({ where: { ownerId: u.id } }), 3);
    ok('real PostgreSQL lock timeout is not a limit rejection; lock released afterwards');
}
async function transactionTimeout() {
    const u = await fixture('premium', 2), locked = gate(), release = gate(), attempting = gate();
    const holder: Hooks = {};
    // Hold the real advisory lock until the service's production SQL lock timeout fires.
    const first = settle(a.$transaction(async tx => {
        const [identity] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        holder.pid = identity.pid;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1297372250, hashtext(${u.id}::uuid::text))::text AS lock`;
        locked.open(); await release.promise;
    }, { timeout: 20000 }));
    const waiter: Hooks = { beforeLock: attempting.open };
    try {
        await bounded(locked.promise);
        const waiting = settle(service(b, waiter).createTrip(u.id, dto as any));
        await bounded(attempting.promise); await blocked(waiter, holder);
        const result = await bounded(waiting);
        assert(result.error); assert.notEqual(result.error.getStatus?.(), 403);
        assert.equal(result.error.meta?.code, '55P03');
        assert.equal(await observer.trips.count({ where: { ownerId: u.id } }), 2);
    } finally { release.open(); assert(!(await first).error); }
    await service(b).createTrip(u.id, dto as any);
    assert.equal(await observer.trips.count({ where: { ownerId: u.id } }), 3);
    ok('production SQL lock timeout prevents insert; subsequent request succeeds');
}
async function monthBoundary() {
    const u = await fixture('premium', 0);
    const before = new Date('2030-01-31T23:59:59.999Z'), after = new Date('2030-02-01T00:00:00.001Z');
    await a.trips.createMany({ data: Array.from({ length: 3 }, () => ({ ownerId: u.id, name: dto.name, destination: dto.destination, transport: dto.transport, from: dto.from, to: dto.to, startDate: before, endDate: before, createdAt: before })) });
    const release = gate(), locked = gate(), attempting = gate();
    const holder: Hooks = { afterLock: async () => { locked.open(); await release.promise; }, clock: before };
    const waiter: Hooks = { beforeLock: attempting.open, clock: after };
    const p = settle(service(a, holder).createTrip(u.id, dto as any));
    let q: ReturnType<typeof settle> | undefined;
    try { await bounded(locked.promise); q = settle(service(b, waiter).createTrip(u.id, dto as any)); await bounded(attempting.promise); await blocked(waiter, holder); }
    finally { release.open(); }
    assert.equal((await p).error.getStatus(), 403);
    const result = await q!; assert(!result.error); assert.equal(result.value.createdAt.toISOString(), after.toISOString());
    const status = await getTripLimitStatus(observer, u.id, after);
    assert.equal(status.used, 1); assert.equal(status.windowStart.toISOString(), '2030-02-01T00:00:00.000Z');
    assert(holder.realClock && waiter.realClock, 'Real post-lock clock queries executed');
    ok('month changes while waiting: post-lock clock controls both count window and persisted timestamp (controlled clock)');
}
async function main() {
    const [identity] = await observer.$queryRaw<Array<{ marker: string; host: string; port: number }>>`SELECT shobj_description(oid, 'pg_database') AS marker, host(inet_server_addr()) AS host, inet_server_port() AS port FROM pg_database WHERE datname=current_database()`;
    assert.equal(identity.marker, 'MEMOTRIP_DUMMYPAY_ISOLATED_IT'); assert.equal(identity.host, '127.0.0.1'); assert.equal(String(identity.port), destination.port);
    await race('premium', 2); await race('premium', 2, true); await race('premium', 2, false, true);
    await race('free', 0); await race('premium', 3); await race('kroniq', 3);
    await differentUsers(); await monthBoundary(); await timeout(); await transactionTimeout();
    console.log(`PASS ${passed} isolated PostgreSQL scenarios; READ COMMITTED, independent connections, production transaction options preserved`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    try { await observer.user.deleteMany({ where: { id: { in: users } } }); }
    finally { await Promise.all([a.$disconnect(), b.$disconnect(), observer.$disconnect()]); }
});
