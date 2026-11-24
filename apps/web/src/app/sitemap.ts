import type { MetadataRoute } from 'next';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://jobpilot.singulr.tech').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: `${siteUrl}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4
    }
  ];
}
