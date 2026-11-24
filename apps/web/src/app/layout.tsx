import type { Metadata } from 'next';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import { ExtensionAuthBridge } from '@/components/auth/extension-auth-bridge';
import './globals.css';

export const metadata: Metadata = {
  title: 'JobPilot // AI Job Search & Application Assistant',
  description:
    'Open-source, privacy-first AI job search, India & global profile manager, and resume assistant.'
};

const THEME_INIT_SCRIPT = `
try {
  var saved = localStorage.getItem("color-scheme");
  if (saved === "light" || saved === "dark") {
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", saved);
  }
} catch (e) {}
`.trim();

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased selection:bg-[var(--accent)] selection:text-white">
        <ExtensionAuthBridge />
        {children}
      </body>
    </html>
  );
}
