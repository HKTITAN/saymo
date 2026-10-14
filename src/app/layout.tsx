import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// One typeface for the post and the viewer. The optical size axis gives the
// big headline the display cut and the small text the text cut, on its own.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Speaker post",
  description: "Aerchain speaker post: Darshan Kadam on SpendOS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
