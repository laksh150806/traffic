import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { AppShell } from "../components/shell/AppShell";
import { EngineProvider } from "../components/shell/engine";
import { FuzzyText, GlitchText } from "../components/fx/text";
import { RetroGrid } from "../components/fx/decor";

import appCss from "../styles.css?url";
import { reportApplicationError } from "../lib/error-reporting";

function NotFoundComponent() {
  return (
    <div className="ops-page relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden text-center">
      <RetroGrid />
      <p className="ops-kicker relative">Route not on the grid</p>
      <div className="relative my-4 flex justify-center">
        <FuzzyText text="404" size={150} />
      </div>
      <p className="ops-sub relative mx-auto">
        No junction, panel or page answers at this address. The signal network is fine; only the
        link is broken.
      </p>
      <Link to="/" className="ops-btn solid relative mt-6">
        Back to the control room
      </Link>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportApplicationError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="ops-page flex min-h-screen flex-col items-center justify-center text-center">
      <p className="ops-kicker">Fault</p>
      <h1 className="ops-h1 mt-2">
        <GlitchText text="Panel failed to load" />
      </h1>
      <p className="ops-sub mt-3">
        Something broke while drawing this page. The signal loop keeps running; try the page again.
      </p>
      <p className="ops-term mt-4 max-w-xl text-left">{error.message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="ops-btn solid"
        >
          Try again
        </button>
        <a href="/" className="ops-btn">
          Control room
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0a0b0c" },
      { title: "SIGNAL OPS · Chennai adaptive signal control" },
      {
        name: "description",
        content:
          "Adaptive traffic signal control for 69 Chennai junctions: a queue model sets the green times, with a forecast and trip planner. Traffic is simulated.",
      },
      { property: "og:title", content: "SIGNAL OPS · Chennai adaptive signal control" },
      {
        property: "og:description",
        content: "Adaptive signal control dashboard for city traffic operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="ops-body">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <EngineProvider>
        <AppShell>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </AppShell>
      </EngineProvider>
    </QueryClientProvider>
  );
}
