"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import ClientRouteHandler from "./_components/client-route-handler";


export default function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // TODO: Sync this with next.config.ts
    const basePath = "/ui";
    const browserPath = window.location.pathname;

    // Only redirect if Next.js thinks we are at root ("/") but the browser URL says otherwise.
    // This indicates we loaded index.html for a deep link.
    if (pathname === "/") {
      if (browserPath.startsWith(basePath) && browserPath !== basePath && browserPath !== basePath + "/") {
        // Deep link (e.g. /ui/instances/foo) -> redirect to /instances/foo
        router.replace(browserPath.replace(basePath, "") || "/");
      } else if (browserPath === basePath || browserPath === basePath + "/") {
        // Root path (e.g. /ui) -> redirect to /instances
        router.replace("/instances");
      }
    }
  }, [router, pathname]);

  return (
    <ClientRouteHandler>
      <></>
    </ClientRouteHandler>
  );
}
