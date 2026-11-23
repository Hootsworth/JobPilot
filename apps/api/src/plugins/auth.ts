import { createClient } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../store/types.js';

export interface AuthVerifier {
  verifyToken(jwt: string): Promise<AuthUser | null>;
}

export function createSupabaseAuthVerifier(
  supabaseUrl: string,
  supabaseAnonKey: string
): AuthVerifier {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return {
    async verifyToken(jwt: string): Promise<AuthUser | null> {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user) return null;
      const meta = data.user.user_metadata as Record<string, unknown> | undefined;
      return {
        id: data.user.id,
        email: data.user.email,
        fullName:
          typeof meta?.['full_name'] === 'string'
            ? meta['full_name']
            : typeof meta?.['name'] === 'string'
              ? meta['name']
              : undefined
      };
    }
  };
}

export function createAuthPreHandler(verifier: AuthVerifier) {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization Bearer token.' });
      return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      reply.code(401).send({ error: 'Empty Bearer token.' });
      return;
    }

    const user = await verifier.verifyToken(token);
    if (!user) {
      reply.code(401).send({ error: 'Invalid or expired authentication token.' });
      return;
    }

    request.authUser = user;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
