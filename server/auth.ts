import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { CONFIG } from './config.ts';
import { getDb, logAudit } from './db.ts';

export type UserRole = 'ADMIN' | 'ANALYST' | 'USER';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  tokenJti?: string;
}

const revokedTokens = new Set<string>();

interface TokenPayload {
  uid: number;
  role: UserRole;
  jti: string;
  exp: number;
}

function signToken(payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', CONFIG.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', CONFIG.SESSION_SECRET)
      .update(data)
      .digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.uid || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    if (revokedTokens.has(parsed.jti)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function issueSessionToken(user: AuthUser): string {
  return signToken({
    uid: user.id,
    role: user.role,
    jti: crypto.randomUUID(),
    exp: Date.now() + CONFIG.SESSION_TTL_MS,
  });
}

export function revokeSessionToken(jti?: string): void {
  if (jti) {
    revokedTokens.add(jti);
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export function validateEmail(email: string): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

export function validateUsername(username: string): boolean {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,40}$/.test(username);
}

export function hasAnyAdmin(db = getDb()): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'ADMIN'`
    )
    .get() as { cnt: number };
  return row.cnt > 0;
}

export function getUserById(id: number, db = getDb()): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.full_name, u.status, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`
    )
    .get(id) as
    | {
        id: number;
        username: string;
        email: string;
        full_name: string;
        status: 'ACTIVE' | 'SUSPENDED';
        role: UserRole;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  const user = getUserById(payload.uid);
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }
  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Account is suspended. Contact an administrator.' });
    return;
  }
  req.user = user;
  req.tokenJti = payload.jti;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      logAudit(getDb(), {
        userId: req.user.id,
        action: 'UNAUTHORIZED_ROLE_ACCESS',
        targetType: 'route',
        targetId: req.originalUrl,
        details: { requiredRoles: allowedRoles, userRole: req.user.role },
        ipAddress: req.ip || null,
      });
      res.status(403).json({ error: 'Insufficient permissions for this action.' });
      return;
    }
    next();
  };
}

export function canAccessDocument(user: AuthUser, documentOwnerId: number): boolean {
  if (user.role === 'ADMIN' || user.role === 'ANALYST') {
    return true;
  }
  return user.id === documentOwnerId;
}

export function checkPasscodeMatch(supplied: string, configured: string): boolean {
  if (!configured) return false;
  const a = crypto.createHash('sha256').update(supplied || '').digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}
