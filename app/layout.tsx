import type { Metadata } from "next";
import { Noto_Sans_Lao, Nunito, Phetsarath, Pixelify_Sans } from "next/font/google";
import "./globals.css";

// Loaded through next/font, which downloads the fonts at build time and serves them from this
// site. A <style>@import from fonts.googleapis.com would be blocked by our Content-Security-Policy.
// English text uses Nunito. Nunito has no Lao letters, so the browser falls through to
// Noto Sans Lao (then Phetsarath) for Lao text. The order is set in globals.css.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

// Pixel font for titles, buttons and labels. Chat and long text stay in Nunito.
const pixelify = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
});

const notoSansLao = Noto_Sans_Lao({
  variable: "--font-noto-sans-lao",
  subsets: ["lao"],
});

const phetsarath = Phetsarath({
  variable: "--font-phetsarath",
  weight: ["400", "700"],
  subsets: ["lao"],
});

export const metadata: Metadata = {
  title: "Duck Room",
  description: "A cozy chat room where everyone is a duck and lofi music plays.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${pixelify.variable} ${notoSansLao.variable} ${phetsarath.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
