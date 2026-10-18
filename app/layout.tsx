import type { Metadata, Viewport } from "next";
import { Inter, Literata } from "next/font/google";
import { ViewTransition } from "react";
import { ToastProvider } from "@/components/ui/Toaster";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

// Inter is the fallback of the system font stack (iPhones show San Francisco); Literata is for titles and the wordmark.
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Literata({ subsets: ["latin"], variable: "--font-literata", display: "swap", weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://libros-kappa.vercel.app"),
  title: { default: "Libros · Aviónica TMC0", template: `%s · ${SITE_NAME}` },
  description: "Los libros del curso de Aviónica (TMC0), en cualquier dispositivo.",
  applicationName: "Libros",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Libros", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" }, // older iOS only reads this name
  openGraph: { title: "Libros · Aviónica TMC0", description: "Los libros del curso de Aviónica (TMC0), en cualquier dispositivo.", locale: "es_ES", type: "website", siteName: "Libros" },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#111214" }],
};

// Runs before first paint: stored choice, else the system setting. This is what prevents a flash.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${serif.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <ToastProvider>
          <ViewTransition>{children}</ViewTransition>
        </ToastProvider>
      </body>
    </html>
  );
}
