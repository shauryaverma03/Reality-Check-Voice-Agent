import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Falls back to 5173 for a plain `npm run dev`, but honors PORT when the
    // harness assigns a different one (e.g. 5173 is taken by another project).
    port: Number(process.env.PORT) || 5173,
    // Without an explicit host, Vite/Node can end up binding only the IPv6
    // loopback (::1) on macOS, which silently refuses IPv4 (127.0.0.1)
    // connections — some browsers then show a blank page instead of a clear
    // connection error. `true` binds all interfaces (both IPv4 and IPv6).
    host: '0.0.0.0',
  },
});
