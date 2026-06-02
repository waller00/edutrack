import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // <--- Agregá esto acá arriba
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

// withSentryConfig agrega tunneling y subida de source maps.
// Si no hay org/project/authToken (CI/local sin credenciales), no sube nada y el build sigue funcionando.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  // No subir source maps si falta el token (evita romper el build).
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
})
