// Run only through run-dummypay-postgres-it.ps1. No dotenv or application bootstrap.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient, PurchasePlan } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';
import { ResolveDummyPaymentResult } from '../src/payments/dto/resolve-dummy-payment.dto';

const marker = 'MEMOTRIP_DUMMYPAY_ISOLATED_IT';
const url = process.env.DUMMYPAY_IT_URL;
if (!url || process.env.DUMMYPAY_IT_MARKER !== marker) throw new Error('Explicit isolated test configuration required');
const destination = new URL(url);
if (destination.hostname !== '127.0.0.1' || destination.port !== process.env.DUMMYPAY_IT_PORT ||
    destination.pathname !== `/${process.env.DUMMYPAY_IT_DATABASE}` ||
    !/^\/dummypay_it_[a-f0-9]{32}$/.test(destination.pathname)) throw new Error('Unsafe test database');
process.env.NODE_ENV = 'development';
process.env.PUBLIC_BASE_URL = 'https://dummypay-it.invalid';
const clients = Array.from({ length: 3 }, () => new PrismaClient({ datasources: { db: { url } } }));
const [clientA, clientB, observer] = clients;
function gate() {
    let open!: () => void;
    const promise = new Promise<void>(resolve => { open = resolve; });
    return { promise, open };
}
async function bounded(promise: Promise<void>, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Barrier timeout: ${label}`)), 10000);
        })]);
    } finally { if (timer) clearTimeout(timer); }
}
type Hooks = { beforeUpdate?: () => Promise<void>; afterUpdate?: () => Promise<void>; beforeLock?: () => Promise<void>; afterLock?: () => Promise<void>; rollbackCreate?: boolean; rollbackUser?: boolean; pid?: number };
const isolations = new Set<string>();
// Only coordinate real calls; no DB results, writes or locks are mocked.
function instrument(client: PrismaClient, hooks: Hooks) {
    return new Proxy(client, {
        get(target, property) {
            if (property !== '$transaction') {
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return (callback: (tx: any) => Promise<unknown>) => target.$transaction(async tx => {
                const [session] = await tx.$queryRaw<Array<{ pid: number; isolation: string }>>`
                    SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation`;
                hooks.pid = session.pid;
                isolations.add(session.isolation);
                assert.equal(session.isolation, 'read committed');
                return callback(new Proxy(tx, {
                    get(transaction, key) {
                        if (key === '$queryRaw') return async (...args: any[]) => {
                            await hooks.beforeLock?.();
                            const result = await (transaction.$queryRaw as any)(...args);
                            await hooks.afterLock?.();
                            return result;
                        };
                        if (key === 'purchase') return new Proxy(transaction.purchase, {
                            get(delegate, method) {
                                if (method === 'create' && hooks.rollbackCreate) return async (args: any) => {
                                    await delegate.create(args);
                                    throw new Error('INJECTED_CREATE_ROLLBACK');
                                };
                                if (method === 'updateMany') return async (args: any) => {
                                    await hooks.beforeUpdate?.();
                                    const result = await delegate.updateMany(args);
                                    await hooks.afterUpdate?.();
                                    return result;
                                };
                                const value = Reflect.get(delegate, method);
                                return typeof value === 'function' ? value.bind(delegate) : value;
                            },
                        });
                        if (key === 'user' && hooks.rollbackUser) return new Proxy(transaction.user, {
                            get(delegate, method) {
                                if (method === 'update') return async (args: any) => {
                                    await delegate.update(args);
                                    throw new Error('INJECTED_TEST_ROLLBACK');
                                };
                                const value = Reflect.get(delegate, method);
                                return typeof value === 'function' ? value.bind(delegate) : value;
                            },
                        });
                        const value = Reflect.get(transaction, key);
                        return typeof value === 'function' ? value.bind(transaction) : value;
                    },
                }));
            }, { timeout: 30000, maxWait: 10000 });
        },
    }) as PrismaService;
}
const plainService = new PaymentsService(clientA as PrismaService);
type Operation = 'cancel' | 'continue' | 'approve' | 'refuse';
let passed = 0;
async function fixture(plan: PurchasePlan) {
    const user = await clientA.user.create({ data: {
        email: `it-${crypto.randomUUID()}@invalid.test`, isPremium: true, isKroniq: true,
    } });
    const purchase = await plainService.createDummyPayment(user.id, plan);
    return { userId: user.id, id: purchase.purchaseId, plan, token: new URL(purchase.paymentUrl).searchParams.get('token')! };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function invoke(service: PaymentsService, op: Operation, f: Fixture) {
    if (op === 'cancel') return service.cancelDummyPayment(f.userId, f.id);
    if (op === 'continue') return service.continueDummyPayment(f.userId, f.id);
    return service.resolveDummyPayment(f.id, f.token, op === 'approve' ? ResolveDummyPaymentResult.APPROVED : ResolveDummyPaymentResult.REFUSED);
}
function settle(promise: Promise<any>) {
    return promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
}
async function waitForBlocking(waiter: Hooks, blocker: Hooks) {
    assert.notEqual(waiter.pid, blocker.pid, 'Operations must use independent PostgreSQL connections');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const [row] = await observer.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT ${blocker.pid!}::int = ANY(pg_blocking_pids(${waiter.pid!}::int)) AS blocked`;
        if (row.blocked) return;
        // Poll actual lock state, not elapsed-time assumptions about operation ordering.
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected PostgreSQL blocking relationship was not observed');
}
async function verify(f: Fixture, state: string) {
    const purchase = await observer.purchase.findUniqueOrThrow({ where: { id: f.id } });
    assert.equal(purchase.status, state);
    assert.equal(purchase.plan, f.plan);
    assert.equal(purchase.provider, 'DUMMY_PAY');
    assert.equal(purchase.currency, 'EUR');
    assert.equal(purchase.amount.toFixed(2), f.plan === 'PREMIUM' ? '5.99' : '36.00');
    assert.equal(await observer.purchase.count({ where: { userId: f.userId } }), 1, 'No duplicate purchases');
    const user = await observer.user.findUniqueOrThrow({ where: { id: f.userId } });
    assert.equal(user.isPremium, state === 'COMPLETED' ? f.plan === 'PREMIUM' : true);
    assert.equal(user.isKroniq, state === 'COMPLETED' ? f.plan === 'KRONIQ' : true);
    assert.equal(purchase.resolvedAt === null, state === 'PENDING');
    return purchase;
}
function ok(name: string) { passed++; console.log(`PASS ${name}`); }
async function createRace(firstPlan: PurchasePlan, secondPlan: PurchasePlan, rollback = false) {
    const user = await clientA.user.create({ data: { email: `recovery-${crypto.randomUUID()}@invalid.test`, isPremium: true, isKroniq: true } });
    const locked = gate(); const release = gate(); const attempting = gate();
    const firstHooks: Hooks = { afterLock: async () => { locked.open(); await release.promise; }, rollbackCreate: rollback };
    const secondHooks: Hooks = { beforeLock: async () => { attempting.open(); } };
    const a = new PaymentsService(instrument(clientA, firstHooks));
    const b = new PaymentsService(instrument(clientB, secondHooks));
    const first = settle(a.createDummyPayment(user.id, firstPlan));
    let second: ReturnType<typeof settle> | undefined;
    try {
        await bounded(locked.promise, 'create advisory lock');
        second = settle(b.createDummyPayment(user.id, secondPlan));
        await bounded(attempting.promise, 'second create lock attempt');
        await waitForBlocking(secondHooks, firstHooks);
    } finally { release.open(); }
    const r1 = await first; const r2 = await second!;
    if (rollback) {
        assert.equal(r1.error?.message, 'INJECTED_CREATE_ROLLBACK');
        assert.equal(r2.error, undefined);
    } else {
        assert.equal(r1.error, undefined);
        assert.equal(r2.error?.getStatus(), 409);
        assert.equal(r2.error?.getResponse().code, 'DUMMY_PAY_PENDING_EXISTS');
    }
    const purchases = await observer.purchase.findMany({ where: { userId: user.id } });
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].status, 'PENDING');
    assert.equal(purchases[0].plan, rollback ? secondPlan : firstPlan);
    const recovered = await plainService.getPendingDummyPayments(user.id);
    assert.equal(recovered.items.length, 1);
    assert.equal(recovered.items[0].purchaseId, purchases[0].id);
    const account = await observer.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(account.isPremium, true); assert.equal(account.isKroniq, true);
    ok(`create ${firstPlan}/${secondPlan}${rollback ? ' with rollback' : ''}: advisory blocking, recovery and no duplicates`);
}
async function recoveryTests() {
    for (const a of Object.values(PurchasePlan)) for (const b of Object.values(PurchasePlan)) await createRace(a, b);
    await createRace(PurchasePlan.PREMIUM, PurchasePlan.KRONIQ, true);
    const independentA = await clientA.user.create({ data: { email: `independent-a-${crypto.randomUUID()}@invalid.test` } });
    const independentB = await clientB.user.create({ data: { email: `independent-b-${crypto.randomUUID()}@invalid.test` } });
    const locked = gate(); const release = gate();
    const first = settle(new PaymentsService(instrument(clientA, {
        afterLock: async () => { locked.open(); await release.promise; },
    })).createDummyPayment(independentA.id, PurchasePlan.PREMIUM));
    try {
        await bounded(locked.promise, 'independent user lock');
        await bounded(new PaymentsService(clientB as PrismaService).createDummyPayment(independentB.id, PurchasePlan.KRONIQ).then(() => {}), 'independent user create must not wait');
    } finally { release.open(); }
    assert.equal((await first).error, undefined);
    ok('different users create independently while the first user advisory lock is held');
    const f = await fixture(PurchasePlan.KRONIQ);
    // Insert synthetic historical duplicates only in the verified isolated test database.
    const original = await observer.purchase.findUniqueOrThrow({ where: { id: f.id } });
    const ids = [f.id];
    for (let i = 0; i < 4; i++) {
        const { id, createdAt, updatedAt, ...data } = original;
        ids.push((await observer.purchase.create({ data: { ...data, plan: i % 2 ? 'PREMIUM' : 'KRONIQ' } })).id);
    }
    const foreign = await fixture(PurchasePlan.PREMIUM);
    await observer.purchase.create({ data: {
        userId: f.userId, provider: 'GOOGLE_PLAY', status: 'PENDING', plan: 'KRONIQ', amount: '36', currency: 'EUR',
    } });
    const snapshot = await observer.purchase.findMany({ where: { userId: f.userId }, orderBy: { id: 'asc' } });
    const found: string[] = [];
    let cursor: string | undefined;
    do {
        const page = await plainService.getPendingDummyPayments(f.userId, 2, cursor);
        for (const item of page.items) {
            assert.deepEqual(Object.keys(item).sort(), ['purchaseId', 'provider', 'status', 'plan', 'createdAt'].sort());
            found.push(item.purchaseId);
        }
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(found, [...ids].sort().reverse());
    assert.equal(found.includes(foreign.id), false);
    const rejection = await settle(plainService.createDummyPayment(f.userId, PurchasePlan.PREMIUM));
    assert.equal(rejection.error?.getStatus(), 409);
    assert.deepEqual(await observer.purchase.findMany({ where: { userId: f.userId }, orderBy: { id: 'asc' } }), snapshot);
    const googleOnly = await clientA.user.create({ data: { email: `google-only-${crypto.randomUUID()}@invalid.test` } });
    await observer.purchase.create({ data: { userId: googleOnly.id, provider: 'GOOGLE_PLAY', status: 'PENDING', plan: 'PREMIUM', amount: '5.99', currency: 'EUR' } });
    await plainService.createDummyPayment(googleOnly.id, PurchasePlan.KRONIQ);
    assert.equal((await plainService.getPendingDummyPayments(googleOnly.id)).items.length, 1);
    ok('historical duplicates, pagination, lost ID, ownership, GOOGLE_PLAY isolation, no data changes');
    const missingUrlUser = await clientA.user.create({ data: { email: `no-url-${crypto.randomUUID()}@invalid.test` } });
    const savedUrl = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    try {
        const result = await settle(plainService.createDummyPayment(missingUrlUser.id, PurchasePlan.PREMIUM));
        assert.equal(result.error?.getStatus(), 500);
        assert.equal(await observer.purchase.count({ where: { userId: missingUrlUser.id } }), 0);
    } finally { process.env.PUBLIC_BASE_URL = savedUrl; }
    ok('missing PUBLIC_BASE_URL creates no purchase');
}
async function race(plan: PurchasePlan, first: Operation, second: Operation, rollback = false) {
    const f = await fixture(plan);
    const changed = gate(); const release = gate(); const attempting = gate();
    const firstHooks: Hooks = { afterUpdate: async () => { changed.open(); await release.promise; }, rollbackUser: rollback };
    const secondHooks: Hooks = { beforeUpdate: async () => { attempting.open(); } };
    const a = new PaymentsService(instrument(clientA, firstHooks));
    const b = new PaymentsService(instrument(clientB, secondHooks));
    const firstResult = settle(invoke(a, first, f));
    let secondResult: ReturnType<typeof settle> | undefined;
    try {
        await bounded(changed.promise, 'first update');
        secondResult = settle(invoke(b, second, f));
        await bounded(attempting.promise, 'second update');
        await waitForBlocking(secondHooks, firstHooks);
    } finally { release.open(); }
    const r1 = await firstResult;
    const r2 = await secondResult!;
    if (rollback) assert.equal(r1.error?.message, 'INJECTED_TEST_ROLLBACK');
    else assert.equal(r1.error, undefined);
    const stale = !rollback && first === 'continue' && (second === 'approve' || second === 'refuse');
    if (stale) assert.equal(r2.error?.getStatus(), 404);
    else assert.equal(r2.error, undefined);
    const winner = rollback ? second : first;
    const state = winner === 'approve' ? 'COMPLETED' : winner === 'cancel' || winner === 'refuse' ? 'FAILED'
        : second === 'cancel' ? 'FAILED' : 'PENDING';
    const stored = await verify(f, state);
    if (second === 'continue' && state !== 'PENDING') {
        assert.equal(r2.value.status, state);
        assert.equal('paymentUrl' in r2.value, false);
    }
    if (state === 'PENDING') {
        const latest = second === 'continue' ? r2.value : r1.value;
        const token = new URL(latest.paymentUrl).searchParams.get('token')!;
        assert.equal(stored.accessTokenHash, createHash('sha256').update(token).digest('hex'));
        await plainService.renderDummyPaymentPage(f.id, token);
        await assert.rejects(plainService.renderDummyPaymentPage(f.id, f.token), { status: 404 });
        if (first === 'continue' && second === 'continue') {
            const earlier = new URL(r1.value.paymentUrl).searchParams.get('token')!;
            assert.notEqual(earlier, token);
            await assert.rejects(plainService.renderDummyPaymentPage(f.id, earlier), { status: 404 });
        }
    }
    ok(`${plan}: ${first} -> ${second}${rollback ? ' (first rolls back)' : ''}; database lock observed`);
}
async function main() {
    const [identity] = await observer.$queryRaw<Array<{ db: string; host: string; port: number; marker: string; version: string }>>`
        SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port,
        shobj_description(oid, 'pg_database') AS marker, version() AS version
        FROM pg_database WHERE datname=current_database()`;
    assert.equal(identity.db, process.env.DUMMYPAY_IT_DATABASE);
    assert.equal(identity.host, '127.0.0.1/32');
    assert.equal(identity.port.toString(), process.env.DUMMYPAY_IT_PORT);
    assert.equal(identity.marker, marker);
    assert.match(identity.version, /PostgreSQL 17\.6/);
    await recoveryTests();
    for (const plan of Object.values(PurchasePlan)) {
        for (const [a, b] of [
            ['cancel', 'approve'], ['approve', 'cancel'],
            ['continue', 'approve'], ['approve', 'continue'],
            ['continue', 'refuse'], ['refuse', 'continue'],
            ['continue', 'cancel'], ['cancel', 'continue'], ['continue', 'continue'],
        ] as Array<[Operation, Operation]>) await race(plan, a, b);
        await race(plan, 'approve', 'continue', true);
        await race(plan, 'approve', 'cancel', true);
        const f = await fixture(plan);
        const first = await plainService.continueDummyPayment(f.userId, f.id);
        const retry = await plainService.continueDummyPayment(f.userId, f.id);
        assert.ok('paymentUrl' in first && 'paymentUrl' in retry);
        const firstToken = new URL(first.paymentUrl!).searchParams.get('token')!;
        const retryToken = new URL(retry.paymentUrl!).searchParams.get('token')!;
        assert.notEqual(firstToken, retryToken);
        await assert.rejects(plainService.renderDummyPaymentPage(f.id, firstToken), { status: 404 });
        await plainService.renderDummyPaymentPage(f.id, retryToken);
        await verify(f, 'PENDING');
        await plainService.cancelDummyPayment(f.userId, f.id);
        const resolvedAt = (await verify(f, 'FAILED')).resolvedAt;
        await plainService.cancelDummyPayment(f.userId, f.id);
        assert.deepEqual((await verify(f, 'FAILED')).resolvedAt, resolvedAt);
        await assert.rejects(invoke(plainService, 'approve', f), { status: 404 });
        const terminal = await plainService.resolveDummyPayment(f.id, retryToken, ResolveDummyPaymentResult.APPROVED);
        assert.match(terminal, /FAILED/);
        const after = await plainService.continueDummyPayment(f.userId, f.id);
        assert.equal('paymentUrl' in after, false);
        await verify(f, 'FAILED');
        ok(`${plan}: lost Continue response, repeated Cancel, old/new links after Cancel, unchanged tariffs and count`);
    }
    console.log(`PASS ${passed} integration scenarios; transaction isolation: ${[...isolations].join(', ')}`);
}
main().catch(error => {
    // Print no request data, URLs, query parameters or credentials on failure.
    console.error(`FAIL isolated integration test: ${error.name}; ${error.code ?? 'assertion-or-runtime'}`);
    if (error instanceof assert.AssertionError) console.error(`Assertion at ${error.stack?.split('\n').find(line => line.includes('dummypay-postgres-it.ts'))?.trim()}`);
    process.exitCode = 1;
}).finally(async () => { await Promise.all(clients.map(client => client.$disconnect())); });
