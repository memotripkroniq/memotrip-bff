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
type Hooks = { beforeUpdate?: () => Promise<void>; afterUpdate?: () => Promise<void>; rollbackUser?: boolean; pid?: number };
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
                        if (key === 'purchase') return new Proxy(transaction.purchase, {
                            get(delegate, method) {
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
