import type { MetadataRoute } from 'next';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jobpilot.singulr.tech').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/privacy', '/terms'],
        disallow: [
          '/profile',
          '/jobs',
          '/tailor',
          '/tracker',
          '/stories',
          '/answers',
          '/usage',
          '/settings',
          '/onboarding',
          '/auth/'
        ]
      }
    ],
    sitemap: `${siteUrl}/sitemap.xml`
  };
}
