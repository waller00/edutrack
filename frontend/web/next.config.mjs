/** @type {import('next').NextConfig} */
export default {
  output: 'standalone', // <--- Agregá esto acá arriba
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/teacher/reports', destination: '/teacher/attendance', permanent: false },
      { source: '/staff/reports', destination: '/staff/attendance', permanent: false },
    ]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}