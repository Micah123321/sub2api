import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import {
  canAccessAgent,
  type AuthUser,
  type SessionUser,
} from './auth.types';
import { hashPassword, verifyPassword } from './password';
import { SessionStore } from './session.store';

describe('auth foundation', () => {
  it('hashes with Argon2id and verifies without exposing the password', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toContain('$argon2id$');
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'wrong password')).resolves.toBe(false);
  });

  it('stores only a hash and expires sessions', () => {
    let now = 1_000;
    const store = new SessionStore({ now: () => now });
    const user: SessionUser = {
      userId: 'agent-user',
      role: 'AGENT',
      agentId: 'agent-1',
    };
    const created = store.create(user, 100);

    expect(created.record.tokenHash).not.toBe(created.token);
    expect(store.get(created.token)).toEqual(user);
    now = 1_100;
    expect(store.get(created.token)).toBeNull();
    expect(store.revoke(created.token)).toBe(false);
  });

  it('creates configurable secure cookies and rejects disabled users', async () => {
    const passwordHash = await hashPassword('secret');
    const user: AuthUser = {
      id: 'admin-1',
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    };
    const service = new AuthService(
      (username) => (username === user.username ? user : null),
      {
        sessionTtlMs: 60_000,
        cookie: { secure: true, sameSite: 'lax' },
      },
    );

    const result = await service.login({ username: 'admin', password: 'secret' });
    expect(result.user).toEqual({
      userId: 'admin-1',
      role: 'ADMIN',
      agentId: null,
    });
    expect(result.cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
    expect(service.authenticate(result.cookie.value)).toEqual(result.user);
    expect(service.logout(result.cookie.value)).toBe(true);
    expect(() => service.authenticate(result.cookie.value)).toThrowError(
      expect.objectContaining({ code: 'SESSION_INVALID' }),
    );

    const disabledService = new AuthService(() => ({ ...user, status: 'DISABLED' }));
    await expect(
      disabledService.login({ username: 'admin', password: 'secret' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('uses the session agentId for agent scope decisions', () => {
    const agent: SessionUser = {
      userId: 'agent-user',
      role: 'AGENT',
      agentId: 'agent-1',
    };
    expect(canAccessAgent(agent, 'agent-1')).toBe(true);
    expect(canAccessAgent(agent, 'agent-2')).toBe(false);
    expect(
      canAccessAgent({ userId: 'admin', role: 'ADMIN', agentId: null }, 'agent-2'),
    ).toBe(true);
  });
});
