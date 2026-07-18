# Stale Following Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove persistently inaccessible following IDs after fifteen failures spanning more than fourteen days without treating temporary downstream outages as invalid followings.

**Architecture:** Keep failure state in a dedicated hash on the calling user's authoritative object. `update_following_tweets` owns recording, resetting, threshold evaluation, and persistence because its home-node branch already owns the following list.

**Tech Stack:** Leither MApp JavaScript, Node.js built-in `node:test` and `vm` for isolated regression coverage.

## Global Constraints

- Do not change the existing `list_of_followings_mid` value format.
- Mutate failure state and following membership only on the calling user's `hostIds[0]`.
- Verify `request.hostid` against the calling user's stored `hostIds[0]` before routing or mutation.
- Remove on the fifteenth or later failure only when the first failure is strictly more than fourteen days old.
- Reset failure state as soon as the followed user object is read successfully.
- Return an error when bookkeeping or persistence fails.
- Do not run tests unless the user explicitly requests it.

---

### Task 1: Regression Coverage

**Files:**
- Create: `tests/update_following_tweets.test.js`

**Interfaces:**
- Consumes: the `update_following_tweets.js` MApp entry point and mocked `lapi` storage operations.
- Produces: regression cases for `failed_following_accesses` and `list_of_followings_mid` mutations.

- [ ] **Step 1: Build a VM-based MApp harness**

Load the production entry point with `vm.runInNewContext`, provide a deterministic clock and a minimal `lapi` implementation, and capture hash writes, deletions, backups, and publishes.

- [ ] **Step 2: Add threshold and reset cases**

Assert failure thresholds and resets, malformed-record recovery, authoritative-host rejection, conservative partial mutation handling, and persistence-error responses.

- [ ] **Step 3: Do not execute the tests**

The repository instruction prohibits test execution without an explicit user request. Validate only with `node --check tests/update_following_tweets.test.js`.

### Task 2: Home-Node Failure Tracking

**Files:**
- Modify: `update_following_tweets.js`

**Interfaces:**
- Consumes: the calling user's stored `hostIds[0]`, plus `lapi.Hget`, `lapi.Hset`, `lapi.Hdel`, `lapi.MMBackup`, and `lapi.MiMeiPublish` against the calling user's current session.
- Produces: per-following records shaped as `{firstFailedAt: number, lastFailedAt: number, attempts: number}`.

- [ ] **Step 1: Add constants and mutation state**

Define the failure hash key, fifteen-attempt threshold, fourteen-day duration, and a flag that records whether the calling user object changed.

- [ ] **Step 2: Verify authoritative routing**

Read the calling user object and reject missing or mismatched `hostIds[0]` before routing or mutation.

- [ ] **Step 3: Record and evaluate failed access**

On a missing or unreadable user object, preserve a valid prior `firstFailedAt`, increment `attempts`, and either update the failure hash or remove both the following and its failure record when both thresholds are met.

- [ ] **Step 4: Reset on successful access**

Immediately delete existing failure state after reading the followed user object, before synchronization or tweet access, so later transient failures cannot count against the following.

- [ ] **Step 5: Persist every calling-user mutation**

Back up and publish when tweets were added or failure tracking/following membership changed.

- [ ] **Step 6: Perform non-test verification**

Run `node --check update_following_tweets.js` and `node --check tests/update_following_tweets.test.js`, then inspect `git diff --check` and the focused diff. Do not run the test suite.
