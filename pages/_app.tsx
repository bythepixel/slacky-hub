import '../styles/globals.css'
import type { AppProps } from 'next/app'
import type { Session } from 'next-auth'

import { SessionProvider } from "next-auth/react"

type AppPropsWithAuth = AppProps & {
    pageProps: {
        session?: Session
    }
}

function MyApp({ Component, pageProps: { session, ...pageProps } }: AppPropsWithAuth) {
    return (
        <SessionProvider session={session}>
            <Component {...pageProps} />
        </SessionProvider>
    )
}

export default MyApp
