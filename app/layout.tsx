import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arc — Vulcan OmniPro 220 Agent",
  description: "Multimodal reasoning agent for the Vulcan OmniPro 220 multiprocess welder.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Linked rather than next/font: the fonts are a design detail, and a build-time
            font fetch would put the clone-to-running path at the mercy of the network. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
