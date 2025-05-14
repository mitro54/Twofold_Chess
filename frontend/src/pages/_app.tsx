import * as React from "react";
import { HeroUIProvider } from "@heroui/react";
import { SessionProvider } from "next-auth/react";
import "../styles/globals.css";
import type { AppProps } from "next/app";
import { useRouter } from 'next/router';

function MyApp({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter();

  return (
    <SessionProvider session={session}>
      <HeroUIProvider navigate={router.push}>
        <Component {...pageProps} />
      </HeroUIProvider>
    </SessionProvider>
  );
}

export default MyApp;