import * as Sentry from '@sentry/react-router';
import { HydrationBoundary, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Analytics } from '@vercel/analytics/react';
import { Suspense, useEffect } from 'react';
import {
  Links,
  type LinksFunction,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useNavigate,
} from 'react-router';
import agicashLoadingLogo from '~/assets/full_logo.png';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Toaster } from '~/components/ui/toaster';
import { ThemeProvider, useTheme } from '~/features/theme';
import { getBgColorForTheme } from '~/features/theme/colors';
import { getThemeCookies } from '~/features/theme/theme-cookies.server';
import { transitionStyles, useViewTransitionEffect } from '~/lib/transitions';
import stylesheet from '~/tailwind.css?url';
import type { Route } from './+types/root';
import { LoadingScreen } from './features/loading/LoadingScreen';
import { NotFoundError } from './features/shared/error';
import { useDehydratedState } from './hooks/use-dehydrated-state';
import { getQueryClient } from './query-client';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'stylesheet', href: transitionStyles },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'manifest',
    href: '/manifest.webmanifest',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Kode+Mono:wght@400..700&family=Teko:wght@300..700&display=swap',
  },
  {
    rel: 'preload',
    href: agicashLoadingLogo,
    as: 'image',
  },
  {
    rel: 'icon',
    href: '/favicon.ico',
    type: 'image/x-icon',
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  /** Returns user settings from cookies */
  const cookieSettings = getThemeCookies(request);
  const userAgentString = request.headers.get('user-agent');
  const url = new URL(request.url);

  return {
    cookieSettings: cookieSettings || null,
    userAgentString: userAgentString || '',
    origin: url.origin,
    domain: url.host,
  };
}

export const meta = ({ loaderData }: Route.MetaArgs) => {
  const { origin } = loaderData || {};

  const title = 'Agicash';
  const description = 'The easiest way to send and receive cash.';
  const image = '/icon-192x192.png';
  const imageWidth = '192';
  const imageHeight = '192';
  const imageType = 'image/png';
  const imageAlt = 'Agicash logo';
  const ogSiteName = 'Agicash';

  return [
    // Basic meta tags
    { title },
    { name: 'description', content: description },
    {
      name: 'keywords',
      content:
        'bitcoin, lightning, cashu, ecash, digital cash, wallet, agicash',
    },

    // Open Graph meta tags
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { property: 'og:image:alt', content: imageAlt },
    {
      property: 'og:image:width',
      content: imageWidth,
    },
    {
      property: 'og:image:height',
      content: imageHeight,
    },
    {
      property: 'og:image:type',
      content: imageType,
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: origin },
    { property: 'og:site_name', content: ogSiteName },

    // Twitter Card meta tags
    { name: 'twitter:card=', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: imageAlt },
  ];
};

// prevent loader from being revalidated
export function shouldRevalidate() {
  return false;
}

const vercelAnalyticsMode =
  process.env.NODE_ENV === 'production' && process.env.VERCEL
    ? 'production'
    : 'development';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LayoutContent>{children}</LayoutContent>
    </ThemeProvider>
  );
}

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { themeClassName, theme, effectiveColorMode } = useTheme();

  return (
    <html lang="en" className={themeClassName}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="theme-color"
          content={getBgColorForTheme(theme, effectiveColorMode)}
        />
        <Meta />
        <Links />
      </head>
      {/* overflow-hidden prevents rubberbanding on scroll */}
      <body className="overflow-hidden">
        {children}
        <ScrollRestoration />
        <Scripts />
        <Analytics mode={vercelAnalyticsMode} />
        <Toaster />
      </body>
    </html>
  );
}

export default function App() {
  const queryClient = getQueryClient();
  const dehydratedState = useDehydratedState();
  useViewTransitionEffect();

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <Suspense fallback={<LoadingScreen />}>
          <Outlet />
        </Suspense>
        <ReactQueryDevtools initialIsOpen={false} />
      </HydrationBoundary>
    </QueryClientProvider>
  );
}

const useErrorDetails = (error: unknown) => {
  const navigate = useNavigate();

  const reload = () => {
    window.location.reload();
  };

  if (isRouteErrorResponse(error)) {
    return {
      message: `${error.status} - ${error.statusText || 'Error'}`,
      additionalInfo: error.data ? (
        <pre className="overflow-auto rounded-lg bg-muted p-4">
          {JSON.stringify(error.data, null, 2)}
        </pre>
      ) : null,
      footer: (
        <Button variant="default" type="button" onClick={reload}>
          Reload Page
        </Button>
      ),
    };
  }

  if (error instanceof NotFoundError) {
    return {
      message: error.message,
      footer: (
        <Button
          className="mt-4"
          variant="default"
          type="button"
          onClick={() => navigate('/')}
        >
          Go Home
        </Button>
      ),
    };
  }

  if (error instanceof Error) {
    return {
      message: 'An unexpected error occurred. Please try again later.',
      additionalInfo: (
        <p className="overflow-auto rounded-lg bg-muted p-4">{error.message}</p>
      ),
      footer: (
        <Button variant="default" type="button" onClick={reload}>
          Reload Page
        </Button>
      ),
      shouldReport: true,
    };
  }

  return {
    message: 'An unexpected error occurred. Please try again later.',
    footer: (
      <Button className="mt-4" variant="default" type="button" onClick={reload}>
        Reload Page
      </Button>
    ),
    shouldReport: true,
  };
};

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const errorDetails = useErrorDetails(error);

  useEffect(() => {
    if (errorDetails.shouldReport) {
      Sentry.captureException(error);
      console.error(error, { time: new Date().toISOString() });
    }
  }, [errorDetails.shouldReport, error]);

  return (
    <Card className="m-4">
      <CardHeader>
        <CardTitle>Oops, something went wrong</CardTitle>
        <CardDescription>{errorDetails.message}</CardDescription>
      </CardHeader>
      {errorDetails.additionalInfo && (
        <CardContent>{errorDetails.additionalInfo}</CardContent>
      )}
      <CardFooter>{errorDetails.footer}</CardFooter>
    </Card>
  );
}

const timingMiddleware: Route.unstable_ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const start = performance.now();

  await next();

  const end = performance.now();
  const duration = end - start;

  console.debug(
    `Client navigation to ${request.url} took ${duration.toFixed(2)}ms`,
    {
      time: new Date().toISOString(),
      start,
      end,
      duration,
      location: request.url,
    },
  );
};

export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] =
  [timingMiddleware];
