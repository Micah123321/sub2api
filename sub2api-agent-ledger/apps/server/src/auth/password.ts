import argon2 from 'argon2';

const ARGON2ID_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) {
    throw new TypeError('Password must not be empty');
  }

  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}
