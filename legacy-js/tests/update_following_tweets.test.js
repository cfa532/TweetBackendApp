'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, '..', 'update_following_tweets.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8')

const APP_ID = 'tweet-app'
const APP_USER_ID = 'calling-user'
const APP_USER_HOME = 'calling-user-home'
const FOLLOWED_USER_ID = 'followed-user'
const FOLLOWED_USER_HOME = 'followed-user-home'
const FOLLOWINGS_LIST = 'list_of_followings_mid'
const FAILED_ACCESSES = 'failed_following_accesses'
const DAY_MS = 24 * 60 * 60 * 1000
const FOURTEEN_DAYS_MS = 14 * DAY_MS
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0)

function normalize(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createHarness(options = {}) {
    const actualCallingUserHome = options.actualCallingUserHome ?? APP_USER_HOME
    const nodeId = options.nodeId ?? actualCallingUserHome
    const requestHostId = options.requestHostId ?? actualCallingUserHome
    const objects = new Map()
    const writes = []
    const deletions = []
    const backups = []
    const publishes = []
    const events = []

    function objectKey(hostId, mid) {
        return `${hostId}:${mid}`
    }

    function ensureObject(hostId, mid) {
        const key = objectKey(hostId, mid)
        if (!objects.has(key)) {
            objects.set(key, {
                hashes: new Map(),
                values: new Map(),
                sortedSets: new Map()
            })
        }
        return objects.get(key)
    }

    function ensureHash(hostId, mid, hashKey) {
        const object = ensureObject(hostId, mid)
        if (!object.hashes.has(hashKey)) {
            object.hashes.set(hashKey, new Map())
        }
        return object.hashes.get(hashKey)
    }

    function ensureSortedSet(hostId, mid, setKey) {
        const object = ensureObject(hostId, mid)
        if (!object.sortedSets.has(setKey)) {
            object.sortedSets.set(setKey, new Map())
        }
        return object.sortedSets.get(setKey)
    }

    const followingValue = options.followingValue ?? 1_720_000_000_123
    ensureObject(nodeId, APP_USER_ID).values.set('data_of_author', {
        id: APP_USER_ID,
        hostIds: [actualCallingUserHome]
    })
    ensureHash(nodeId, APP_USER_ID, FOLLOWINGS_LIST)
        .set(FOLLOWED_USER_ID, followingValue)

    if (options.failureState) {
        ensureHash(nodeId, APP_USER_ID, FAILED_ACCESSES)
            .set(FOLLOWED_USER_ID, options.failureState)
    }

    if (options.followedUser) {
        ensureObject(nodeId, FOLLOWED_USER_ID).values
            .set('data_of_author', options.followedUser)
    }

    function session(mid, version) {
        return {hostId: nodeId, mid, version}
    }

    function dataFor(sid) {
        return ensureObject(sid.hostId, sid.mid)
    }

    const lapi = {
        BELoginAsAuthor() {
            return session('authenticated-author', 'auth')
        },

        GetVar(_sid, key) {
            return key === 'hostid' ? nodeId : undefined
        },

        MMOpen(_sid, mid, version) {
            if (mid === FOLLOWED_USER_ID && options.openUserError) {
                throw options.openUserError
            }
            return session(mid, version)
        },

        Get(sid, key) {
            if (sid.mid === FOLLOWED_USER_ID && options.readUserError) {
                throw options.readUserError
            }
            const value = dataFor(sid).values.get(key)
            if (sid.mid === FOLLOWED_USER_ID && value !== undefined) {
                events.push({
                    type: 'followed-user-read',
                    hostId: sid.hostId,
                    mid: sid.mid,
                    key
                })
            }
            return value
        },

        Hkeys(sid, key) {
            return [...ensureHash(sid.hostId, sid.mid, key).keys()]
        },

        Hget(sid, key, field) {
            if (sid.mid === APP_USER_ID &&
                key === FAILED_ACCESSES &&
                field === FOLLOWED_USER_ID &&
                options.failureRecordReadError) {
                const operation = {hostId: sid.hostId, mid: sid.mid, key, field}
                events.push({type: 'hash-read-error', ...operation})
                throw options.failureRecordReadError
            }
            return ensureHash(sid.hostId, sid.mid, key).get(field)
        },

        Hset(sid, key, field, value) {
            ensureHash(sid.hostId, sid.mid, key).set(field, value)
            const mutation = {hostId: sid.hostId, mid: sid.mid, key, field, value}
            writes.push(mutation)
            events.push({type: 'hash-write', ...mutation})
        },

        Hdel(sid, key, field) {
            const mutation = {hostId: sid.hostId, mid: sid.mid, key, field}
            if (sid.mid === APP_USER_ID &&
                key === FOLLOWINGS_LIST &&
                field === FOLLOWED_USER_ID &&
                options.followingDeleteError) {
                events.push({type: 'hash-delete-error', ...mutation})
                throw options.followingDeleteError
            }
            ensureHash(sid.hostId, sid.mid, key).delete(field)
            deletions.push(mutation)
            events.push({type: 'hash-delete', ...mutation})
        },

        Zrevrange(sid, key, start, stop) {
            const entries = [...ensureSortedSet(sid.hostId, sid.mid, key)]
                .map(([Member, Score]) => ({Member, Score}))
                .sort((a, b) => b.Score - a.Score)
            return entries.slice(start, stop + 1)
        },

        Zrangebyscore(sid, key, min, max, offset, count) {
            return [...ensureSortedSet(sid.hostId, sid.mid, key)]
                .map(([Member, Score]) => ({Member, Score}))
                .filter(entry => entry.Score >= min && entry.Score <= max)
                .sort((a, b) => a.Score - b.Score)
                .slice(offset, offset + count)
        },

        Zadd(sid, key, ...entries) {
            const set = ensureSortedSet(sid.hostId, sid.mid, key)
            for (const entry of entries) {
                set.set(entry.Member, entry.Score)
            }
        },

        MMBackup(sid, mid) {
            const operation = {hostId: sid.hostId, sidMid: sid.mid, mid}
            backups.push(operation)
            events.push({type: 'backup', ...operation})
            if (options.backupError) {
                throw options.backupError
            }
        },

        MiMeiPublish(sid, _unused, mid) {
            const operation = {hostId: sid.hostId, sidMid: sid.mid, mid}
            publishes.push(operation)
            events.push({type: 'publish', ...operation})
            if (options.publishError) {
                throw options.publishError
            }
        },

        RunMApp(name) {
            events.push({type: 'run-mapp', name})
            if (name === 'node_update_mid_by_score' && options.downstreamSyncError) {
                throw options.downstreamSyncError
            }
            return name === 'get_tweet'
                ? {success: true, data: {id: 'unused-tweet'}}
                : null
        },

        Debug() {},
        Error() {},
        Warn(...args) {
            events.push({type: 'warn', args})
        }
    }

    class FixedDate extends Date {
        static now() {
            return options.now ?? NOW
        }
    }

    const request = {
        aid: APP_ID,
        appuserid: APP_USER_ID,
        hostid: requestHostId,
        version: 'v2'
    }

    const result = vm.runInNewContext(SOURCE, {
        Date: FixedDate,
        args: [],
        lapi,
        request
    }, {filename: SOURCE_PATH})

    function hashAt(hostId, mid, key) {
        return ensureHash(hostId, mid, key)
    }

    return {
        result,
        actualCallingUserHome,
        followingValue,
        writes,
        deletions,
        backups,
        publishes,
        events,
        failureRecord: () => hashAt(nodeId, APP_USER_ID, FAILED_ACCESSES)
            .get(FOLLOWED_USER_ID),
        hasFollowing: () => hashAt(nodeId, APP_USER_ID, FOLLOWINGS_LIST)
            .has(FOLLOWED_USER_ID),
        storedFollowingValue: () => hashAt(nodeId, APP_USER_ID, FOLLOWINGS_LIST)
            .get(FOLLOWED_USER_ID)
    }
}

function assertCallerHomePersistence(harness) {
    assert.equal(harness.backups.length, 1, 'the changed calling-user object is backed up')
    assert.equal(harness.publishes.length, 1, 'the changed calling-user object is published')

    for (const operation of [
        ...harness.writes,
        ...harness.deletions,
        ...harness.backups.map(({hostId, mid}) => ({hostId, mid})),
        ...harness.publishes.map(({hostId, mid}) => ({hostId, mid}))
    ]) {
        assert.equal(operation.hostId, harness.actualCallingUserHome)
        assert.equal(operation.mid, APP_USER_ID)
    }
}

test('rejects request and current nodes that do not match the calling user home', () => {
    const wrongHost = 'untrusted-request-host'
    const harness = createHarness({
        actualCallingUserHome: APP_USER_HOME,
        requestHostId: wrongHost,
        nodeId: wrongHost
    })

    assert.equal(harness.result.success, false)
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assert.equal(harness.failureRecord(), undefined)
    assert.deepEqual(harness.writes, [])
    assert.deepEqual(harness.deletions, [])
    assert.deepEqual(harness.backups, [])
    assert.deepEqual(harness.publishes, [])
})

test('first unreadable access creates a failure record without changing the following value', () => {
    const harness = createHarness({
        readUserError: new Error('followed user cannot be read')
    })

    assert.equal(harness.result.success, true)
    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt: NOW,
        lastFailedAt: NOW,
        attempts: 1
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assertCallerHomePersistence(harness)
})

test('backup failure after bookkeeping mutation returns failure after one persistence retry', () => {
    const harness = createHarness({
        backupError: new Error('calling-user backup failed')
    })

    assert.equal(harness.result.success, false)
    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt: NOW,
        lastFailedAt: NOW,
        attempts: 1
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assert.equal(harness.backups.length, 2, 'initial backup and catch-path retry are attempted')
    assert.equal(harness.publishes.length, 0, 'publish is not attempted after either backup fails')
})

test('publish failure after bookkeeping mutation returns failure after one persistence retry', () => {
    const harness = createHarness({
        publishError: new Error('calling-user publish failed')
    })

    assert.equal(harness.result.success, false)
    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt: NOW,
        lastFailedAt: NOW,
        attempts: 1
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assert.equal(harness.backups.length, 2, 'each persistence attempt backs up once')
    assert.equal(harness.publishes.length, 2, 'initial publish and catch-path retry are attempted')
})

test('malformed prior failure state restarts conservatively at the first attempt', () => {
    const harness = createHarness({
        failureState: {
            firstFailedAt: null,
            lastFailedAt: NOW - DAY_MS,
            attempts: 14
        }
    })

    assert.equal(harness.result.success, true)
    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt: NOW,
        lastFailedAt: NOW,
        attempts: 1
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assertCallerHomePersistence(harness)
})

test('fifteenth failure before fourteen days retains the following', () => {
    const firstFailedAt = NOW - FOURTEEN_DAYS_MS + 1
    const harness = createHarness({
        failureState: {
            firstFailedAt,
            lastFailedAt: NOW - DAY_MS,
            attempts: 14
        }
    })

    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt,
        lastFailedAt: NOW,
        attempts: 15
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assertCallerHomePersistence(harness)
})

test('fifteenth failure at exactly fourteen days retains the following', () => {
    const firstFailedAt = NOW - FOURTEEN_DAYS_MS
    const harness = createHarness({
        failureState: {
            firstFailedAt,
            lastFailedAt: NOW - DAY_MS,
            attempts: 14
        }
    })

    assert.deepEqual(normalize(harness.failureRecord()), {
        firstFailedAt,
        lastFailedAt: NOW,
        attempts: 15
    })
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assertCallerHomePersistence(harness)
})

test('fifteenth failure more than fourteen days after the first removes the stale following', () => {
    const harness = createHarness({
        failureState: {
            firstFailedAt: NOW - FOURTEEN_DAYS_MS - 1,
            lastFailedAt: NOW - DAY_MS,
            attempts: 14
        }
    })

    assert.equal(harness.failureRecord(), undefined)
    assert.equal(harness.hasFollowing(), false)
    assertCallerHomePersistence(harness)
})

test('failure after the fifteenth attempt removes an old stale following', () => {
    const harness = createHarness({
        failureState: {
            firstFailedAt: NOW - FOURTEEN_DAYS_MS - 1,
            lastFailedAt: NOW - DAY_MS,
            attempts: 15
        }
    })

    assert.equal(harness.failureRecord(), undefined)
    assert.equal(harness.hasFollowing(), false)
    assertCallerHomePersistence(harness)
})

test('partial stale-following removal reports failure and persists the conservative state', () => {
    const harness = createHarness({
        failureState: {
            firstFailedAt: NOW - FOURTEEN_DAYS_MS - 1,
            lastFailedAt: NOW - DAY_MS,
            attempts: 14
        },
        followingDeleteError: new Error('following-list deletion failed')
    })

    assert.equal(harness.result.success, false)
    assert.equal(harness.failureRecord(), undefined)
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)

    const failureRecordDeleteIndex = harness.events.findIndex(event =>
        event.type === 'hash-delete' &&
        event.key === FAILED_ACCESSES &&
        event.field === FOLLOWED_USER_ID
    )
    const followingDeleteErrorIndex = harness.events.findIndex(event =>
        event.type === 'hash-delete-error' &&
        event.key === FOLLOWINGS_LIST &&
        event.field === FOLLOWED_USER_ID
    )
    assert.notEqual(failureRecordDeleteIndex, -1, 'failure bookkeeping was cleared')
    assert.notEqual(followingDeleteErrorIndex, -1, 'following deletion was attempted')
    assert.ok(
        failureRecordDeleteIndex < followingDeleteErrorIndex,
        'failure bookkeeping is deleted before following membership'
    )
    assertCallerHomePersistence(harness)
})

test('successful user read clears prior failure state before a downstream sync error', () => {
    const harness = createHarness({
        failureState: {
            firstFailedAt: NOW - 30 * DAY_MS,
            lastFailedAt: NOW - DAY_MS,
            attempts: 99
        },
        followedUser: {id: FOLLOWED_USER_ID, hostIds: [FOLLOWED_USER_HOME]},
        downstreamSyncError: new Error('temporary followed-home sync failure')
    })

    assert.equal(harness.failureRecord(), undefined)
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)

    const readIndex = harness.events.findIndex(event =>
        event.type === 'followed-user-read' &&
        event.mid === FOLLOWED_USER_ID &&
        event.key === 'data_of_author'
    )
    const resetIndex = harness.events.findIndex(event =>
        event.type === 'hash-delete' &&
        event.key === FAILED_ACCESSES &&
        event.field === FOLLOWED_USER_ID
    )
    const syncIndex = harness.events.findIndex(event =>
        event.type === 'run-mapp' && event.name === 'node_update_mid_by_score'
    )
    assert.notEqual(readIndex, -1, 'the followed-user object was read successfully')
    assert.notEqual(resetIndex, -1, 'the prior failure record is cleared')
    assert.notEqual(syncIndex, -1, 'the downstream sync was attempted')
    assert.equal(resetIndex, readIndex + 1, 'the reset is the next captured event after the read')
    assert.ok(resetIndex < syncIndex, 'the reset occurs before downstream synchronization')
    assertCallerHomePersistence(harness)
})

test('bookkeeping read error after a successful user read returns a v2 failure', () => {
    const priorFailure = {
        firstFailedAt: NOW - 30 * DAY_MS,
        lastFailedAt: NOW - DAY_MS,
        attempts: 99
    }
    const harness = createHarness({
        failureState: priorFailure,
        followedUser: {id: FOLLOWED_USER_ID, hostIds: [FOLLOWED_USER_HOME]},
        failureRecordReadError: new Error('failure bookkeeping cannot be read')
    })

    assert.equal(harness.result.success, false)
    assert.deepEqual(normalize(harness.failureRecord()), priorFailure)
    assert.equal(harness.hasFollowing(), true)
    assert.strictEqual(harness.storedFollowingValue(), harness.followingValue)
    assert.equal(harness.backups.length, 0)
    assert.equal(harness.publishes.length, 0)

    const readIndex = harness.events.findIndex(event =>
        event.type === 'followed-user-read' && event.mid === FOLLOWED_USER_ID
    )
    const bookkeepingErrorIndex = harness.events.findIndex(event =>
        event.type === 'hash-read-error' && event.key === FAILED_ACCESSES
    )
    assert.notEqual(readIndex, -1, 'the followed-user object was read successfully')
    assert.equal(
        bookkeepingErrorIndex,
        readIndex + 1,
        'failure bookkeeping read fails immediately after the successful user read'
    )
})
