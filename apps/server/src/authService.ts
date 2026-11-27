import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthUser, ClientGroup, UserRole } from '@bullion-desk/shared';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export class AuthService {
  private readonly secret: string;

  constructor(
    private db: Database.Database,
    secret: string = process.env.AUTH_SECRET ?? 'bullion-desk-dev-secret-change-in-prod'
  ) {
    this.secret = secret;
  }

  signToken(user: AuthUser): string {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      clientId: user.clientId,
      clientGroup: user.clientGroup,
      phone: user.phone,
      exp: Date.now() + 24 * 60 * 60 * 1000,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  verifyToken(token: string): AuthUser | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as AuthUser & {
        sub: string;
        exp: number;
      };
      if (Date.now() > payload.exp) return null;
      return {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        displayName: payload.displayName,
        clientId: payload.clientId,
        clientGroup: payload.clientGroup,
        phone: payload.phone,
      };
    } catch {
      return null;
    }
  }

  login(usernameOrPhone: string, password: string): { token: string; user: AuthUser } | null {
    const row = this.db
      .prepare(
        `SELECT u.*, c.client_group, c.phone as client_phone
         FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         WHERE u.username = ? OR c.phone = ?`
      )
      .get(usernameOrPhone.trim(), usernameOrPhone.trim()) as Record<string, unknown> | undefined;

    if (!row) return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;

    const user: AuthUser = {
      id: String(row.id),
      username: String(row.username),
      role: row.role as UserRole,
      displayName: String(row.display_name),
      clientId: row.client_id ? String(row.client_id) : null,
      clientGroup: row.client_group ? (row.client_group as ClientGroup) : null,
      phone: row.phone ? String(row.phone) : row.client_phone ? String(row.client_phone) : null,
    };

    const token = this.signToken(user);
    return { token, user };
  }
}
