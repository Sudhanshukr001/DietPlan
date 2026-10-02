import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Every icon listed here must exist, otherwise the browser logs a
 * 404 and the install prompt breaks — `src/app/icon.svg` is served by Next at
 * `/icon.svg` and is also injected automatically as the favicon.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aaj Ka Khana — daily food and routine companion',
    short_name: 'Aaj Ka Khana',
    description:
      'Plans today’s affordable meals, tells you exactly what to do next, and keeps you on track — offline, without diet culture.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fbf9f6',
    theme_color: '#0f7a5a',
    lang: 'en',
    dir: 'ltr',
    categories: ['health', 'food', 'lifestyle'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
