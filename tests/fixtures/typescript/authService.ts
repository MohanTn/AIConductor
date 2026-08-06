import { JwtHelper } from './jwtHelper';
import type { Token } from '../types/token';
import * as crypto from 'node:crypto';
import defaultConfig from './config';

export interface IAuthService {
  refresh(token: string): Promise<Token>;
}

export type RefreshResult = { token: string; expiresAt: number };

export class AuthService implements IAuthService {
  private readonly helper: JwtHelper;

  constructor(helper: JwtHelper) {
    this.helper = helper;
  }

  async refresh(token: string): Promise<Token> {
    return this.helper.rotate(token);
  }

  get issuer(): string {
    return defaultConfig.issuer;
  }
}

export function rotateRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const buildCacheKey = (userId: string): string => `session:${userId}`;
