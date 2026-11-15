import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// The post's typeface. The optical size axis gives the big headline the
// display cut and the small text the text cut, on its own. The tool and the
// viewer around the post use the Mac's own system font (globals.css).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-post",
});

export const metadata: Metadata = {
  title: "Speaker post",
  description: "Aerchain speaker post: Darshan Kadam on SpendOS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
