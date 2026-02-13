import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Migunani Motor',
    short_name: 'Migunani',
    description: 'Penyedia suku cadang motor berkualitas',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#10b981',
    lang: 'id',
  };
}
