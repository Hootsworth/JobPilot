'use client';

import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getApiBaseUrl } from '@/lib/api';
import { getSupabaseClient, getSupabasePublishableKey } from '@/lib/supabase';

export function ExtensionAuthBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supabase = getSupabaseClient();
    const origin = window.location.origin;
    const apiBaseUrl = getApiBaseUrl();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
    const supabaseAnonKey = getSupabasePublishableKey() || '';

    const postConfig = () => {
      window.postMessage(
        {
          source: 'jobpilot-web-auth',
          type: 'WEB_CONFIG',
          payload: {
            apiBaseUrl,
            webBaseUrl: origin,
            supabaseUrl,
            supabaseAnonKey
          }
        },
        origin
      );
    };

    const postSession = (session: Session | null, clearOnEmpty: boolean) => {
      if (session?.access_token) {
        window.postMessage(
          {
            source: 'jobpilot-web-auth',
            type: 'SESSION_SYNC',
            payload: {
              apiBaseUrl,
              webBaseUrl: origin,
              supabaseUrl,
              supabaseAnonKey,
              accessToken: session.access_token,
              refreshToken: session.refresh_token ?? '',
              email: session.user?.email ?? '',
              expiresAt: session.expires_at ? session.expires_at * 1000 : undefined
            }
          },
          origin
        );
      } else {
        postConfig();
        if (clearOnEmpty) {
          window.postMessage(
            {
              source: 'jobpilot-web-auth',
              type: 'SESSION_SYNC',
              payload: null
            },
            origin
          );
        }
      }
    };

    postConfig();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      postSession(data.session ?? null, false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      postSession(session ?? null, event === 'SIGNED_OUT');
    });

    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin) return;
      const msg = event.data as { source?: string; type?: string } | undefined;
      if (msg?.source === 'jobpilot-extension' && msg?.type === 'REQUEST_SESSION') {
        void supabase.auth.getSession().then(({ data }) => {
          postSession(data.session ?? null, false);
        });
      }
    };

    window.addEventListener('message', onWindowMessage);
    return () => {
      window.removeEventListener('message', onWindowMessage);
      authListener.subscription.unsubscribe();
    };
  }, []);

  return null;
}
