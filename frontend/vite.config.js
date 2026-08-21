import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Without an explicit host, Vite/Node can end up binding only the IPv6
    // loopback (::1) on macOS, which silently refuses IPv4 (127.0.0.1)
    // connections — some browsers then show a blank page instead of a clear
    // connection error. `true` binds all interfaces (both IPv4 and IPv6).
    host: true,
  },
});
