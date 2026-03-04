import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui", margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
