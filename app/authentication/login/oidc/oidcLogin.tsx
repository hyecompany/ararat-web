"use client";

import { useState, useEffect } from "react";
import { Button } from "@/deps/ui-web/components/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/deps/ui-web/components/alert";
import { InfoIcon } from "lucide-react";
import AlreadyAuthenticated from "../../_components/alreadyAuthenticated";

// Hardcoded OIDC login endpoint - this is a trusted Incus API endpoint
const OIDC_LOGIN_ENDPOINT = "/oidc/login";

export default function OidcLogin() {
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Reset redirecting state if the user navigates back or redirect fails
  useEffect(() => {
    if (!isRedirecting) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setIsRedirecting(false);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isRedirecting]);

  function handleOidcLogin() {
    setIsRedirecting(true);
    // Redirect to the Incus OIDC login endpoint
    // The server will handle the OIDC flow and redirect back
    // This should NOT use the absolute URL.
    window.location.href = OIDC_LOGIN_ENDPOINT;
  }

  return (
    <>
      <AlreadyAuthenticated />
      <Alert className="mb-4">
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>OpenID Connect</AlertTitle>
        <AlertDescription>
          You will be redirected to your identity provider to authenticate.
          After successful authentication, you will be returned to this
          application.
        </AlertDescription>
      </Alert>
      <Button onClick={handleOidcLogin} loading={isRedirecting} className="w-full">
        {isRedirecting ? "Redirecting..." : "Login with OpenID Connect"}
      </Button>
    </>
  );
}
