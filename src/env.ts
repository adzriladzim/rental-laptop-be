export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PUBLIC_API_KEY: string;
  PUBLIC_API_ENABLED: string;
  BUSINESS_NAME: string;
  BUSINESS_PHONE: string;
  BUSINESS_EMAIL: string;
  BUSINESS_ADDRESS: string;
  PAYMENT_WEBHOOK_SECRET: string;
  ALLOWED_PUBLIC_API_ORIGINS: string;
}

export type Role = 'SUPER_ADMIN' | 'STAFF';

export interface AuthUser {
  userId: string;
  role: Role;
}

export interface AppVariables {
  user?: AuthUser;
  apiKeyValidated?: boolean;
  validatedBody?: unknown;
  validatedQuery?: unknown;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
