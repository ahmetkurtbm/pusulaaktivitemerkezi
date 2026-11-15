import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import "./globals.css";
import "./portal.css";
import "./topbar.css";
import "./home-v2.css";
import "./admin-events.css";
import "./home-events.css";
import "./results-enhanced.css";
import "./logo.css";
import "./content-features.css";
import "./home-v3.css";
import "./portal-v3.css";


const title = "Pusula Aktivite Merkezi | Eğitim & Etkinlik";
const description = "Osmaniye'de ödev takibi, konu anlatımı, okul öncesi etkinlik, yaz okulu ve atölye programları.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Pusula Aktivite Merkezi",
    locale: "tr_TR",
    type: "website",
    images: [{ url: "/hero-academy.png", width: 1717, height: 916, alt: "Pusula Aktivite Merkezi ödev ve etkinlik alanı" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/hero-academy.png"],
  },
};

export const viewport: Viewport = { themeColor: "#1d4ed8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
