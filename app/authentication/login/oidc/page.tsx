import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/deps/ui-web/components/card";
import OidcLogin from "./oidcLogin";

export const metadata = {
  title: "OpenID Connect Login | Hye Ararat",
  description: "Login to Hye Ararat via OpenID Connect",
};

export default function OidcAuth() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenID Connect Authentication</CardTitle>
        <CardDescription>
          Authenticate with your identity provider
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full">
          <OidcLogin />
        </div>
      </CardContent>
    </Card>
  );
}
