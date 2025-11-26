"use client";

import React from "react";
import ClientRouteHandler from "./_components/client-route-handler";

export default function NotFound() {
    return (
        <ClientRouteHandler>
            <div className="flex h-screen flex-col items-center justify-center gap-4">
                <h1 className="text-4xl font-bold">404</h1>
                <p className="text-muted-foreground">Page not found</p>
                <a href="/" className="text-primary hover:underline">
                    Go back home
                </a>
            </div>
        </ClientRouteHandler>
    );
}
