/** @type {import('next').NextConfig} */
export default {
  output: 'standalone', // <--- Agregá esto acá arriba
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}