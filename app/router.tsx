"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function Router({ children }: { children: React.ReactNode }) {
  const runRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!runRef.current && pathname != "/") {
      runRef.current = true;
      // router.push(pathname);
    }
  }, [pathname, router]);

  return <>{children}</>;
}
