'use client';

import * as React from 'react';
import {
  IconAlertTriangle,
  IconCertificate,
  IconDotsVertical,
  IconLogout,
  IconSettings,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  type Icon,
} from '@tabler/icons-react';
import { useTheme } from 'next-themes';

import {
  Sidebar as RawSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from 'ui-web/components/sidebar';
import {
  BoxesIcon,
  ChevronDownIcon,
  ChevronsLeftRightEllipsisIcon,
  CircleDotDashedIcon,
  HardDriveIcon,
  PackageIcon,
  SquaresIntersectIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'ui-web/components/collapsible';
import Link from 'next/link';
import AuthenticationContext from '../_context/authentication';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from 'ui-web/components/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from 'ui-web/components/avatar';
import UserContext from './_context/user';
import { Skeleton } from 'ui-web/components/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'ui-web/components/tooltip';

type NavMainItem = {
  title: string;
  url: string;
  icon?: Icon;
  subItems?: {
    title: string;
    url: string;
  }[];
};

function getAvatarInitials(source: string | undefined | null): string {
  if (!source || !source.trim()) {
    return "U";
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";

  const initials = parts
    .map((part) => (part && part[0]) || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

const data = {
  navMain: [
    {
      title: 'Instances',
      url: '/instances',
      icon: BoxesIcon,
    },
    /*{
      title: 'Networking',
      url: '#',
      subItems: [
        {
          title: 'Networks',
          url: '/networks',
        },
        {
          title: 'IPAM',
          url: '/networks/ipam',
        },
        {
          title: 'ACLs',
          url: '/networks/acls',
        },
      ],
      icon: ChevronsLeftRightEllipsisIcon,
    },*/
    /*{
      title: 'Storage',
      url: '#',
      subItems: [
        {
          title: 'Pools',
          url: '/storage/pools',
        },
        {
          title: 'Volumes',
          url: '/storage/volumes',
        },
        {
          title: 'ISOs',
          url: '/storage/isos',
        },
        {
          title: 'Buckets',
          url: '/storage/buckets',
        },
      ],
      icon: HardDriveIcon,
    },*/
    /*{
      title: 'Images',
      url: '/images',
      icon: PackageIcon,
    },*/
   /* {
      title: 'Profiles',
      url: '/profiles',
      icon: SquaresIntersectIcon,
    },*/
    {
      title: 'Operations',
      url: '/operations',
      icon: CircleDotDashedIcon,
    },
  ],
  navSecondary: [
    /*{
      title: 'Configuration',
      url: '#',
      icon: IconSettings,
    },
    {
      title: 'Warnings',
      url: '#',
      icon: IconAlertTriangle,
    },*/
  ],
};

export default function Sidebar({
  ...props
}: React.ComponentProps<typeof RawSidebar>) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  React.useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [pathname, isMobile, setOpenMobile]);

  return (
    <RawSidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex w-full mt-4 group-data-[collapsible=icon]:mt-0">
          <img
            src="/ui/images/hyeLogo.png"
            alt="Ararat"
            className="h-full my-auto ml-auto max-h-8 group-data-[collapsible=icon]:max-h-5 group-data-[collapsible=icon]:mr-auto transition-all"
          />
          <div className="text-justify my-auto mr-auto ml-2">
            <p className="font-semibold font-[Poppins] inline-block text-[28px] leading-0 group-data-[collapsible=icon]:hidden">
              Ararat
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain as NavMainItem[]} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </RawSidebar>
  );
}
function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: Icon;
    subItems?: {
      title: string;
      url: string;
    }[];
  }[];
}) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.subItems ? (
                state === 'collapsed' && !isMobile ? (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuButton>
                            {item.icon && <item.icon />}
                            <span>{item.title}</span>
                            {/* ChevronDownIcon removed for collapsed state, as dropdown menu provides indicator */}
                          </SidebarMenuButton>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right" align="center">
                        {item.title}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      sideOffset={20}
                    >
                      <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {item.subItems.map((subItem) => (
                        <DropdownMenuItem key={subItem.title} asChild>
                          <Link href={subItem.url} aria-label={subItem.title}>
                            <span>{subItem.title}</span>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Collapsible className="group/collapsible">
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip={item.title}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                        <div className="[&>svg]:size-4 ml-auto">
                          <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180 " />
                        </div>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {item.subItems.map((subItem) => (
                        <SidebarMenuSub key={subItem.title}>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild>
                              <Link
                                href={subItem.url}
                                aria-label={subItem.title}
                              >
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )
              ) : (
                <Link href={item.url}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(item.url)}
                    tooltip={item.title}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </Link>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    url: string;
    icon: Icon;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <a href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavUser() {
  const { isMobile } = useSidebar();
  const {
    data: authData,
    isValidating: authIsValidating,
    isLoading: authIsLoading,
  } = React.use(AuthenticationContext);
  const {
    data: userData,
    isValidating: userIsValidating,
    isLoading: userIsLoading,
  } = React.use(UserContext);
  const { setTheme } = useTheme();

  const handleLogout = React.useCallback(async () => {
    if (authData?.method === "oidc") {
      try {
        // Call server-side logout to clear session without navigating away
        await fetch("/oidc/logout", {
          method: "GET",
          credentials: "same-origin",
        });
      } catch (err) {
        console.warn("OIDC logout request failed", err);
      }

      // Clear client-side OIDC cookies regardless of server response
      document.cookie = "oidc_id=; path=/; max-age=0; Secure; SameSite=Lax";
      document.cookie =
        "oidc_refresh_token=; path=/; max-age=0; Secure; SameSite=Lax";

      window.location.href = "/ui/authentication/login";
      return;
    }

    // For TLS, just return to login
    window.location.href = "/ui/authentication/login";
  }, [authData]);
  return (
    <SidebarMenu className={authIsValidating ? 'animate-pulse' : ''}>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            disabled={authIsLoading || authData?.method === "tls"}
          >
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                {!authIsLoading ? (
                  authData?.method === "oidc" ? (
                    <>
                      <AvatarImage
                        src={userData?.picture || ""}
                        alt={userData?.name || "user"}
                      />
                      <AvatarFallback className="rounded-lg">
                        {getAvatarInitials(
                          userData?.name || authData?.identifier
                        )}
                      </AvatarFallback>
                    </>
                  ) : (
                    <>
                      <IconCertificate className="m-auto" />
                    </>
                  )
                ) : (
                  <>
                    <Skeleton />
                  </>
                )}
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span
                  className={`truncate font-medium ${userIsValidating ? 'animate-pulse' : ''}`}
                >
                  {!userIsLoading && userData?.name ? userData.name : ""}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {!authIsLoading
                    ? authData?.method === "oidc"
                      ? userData?.email || authData?.identifier || ""
                      : authData?.identifier || ""
                    : ""}
                </span>
              </div>
              {authData?.method === "oidc" ? (
                <IconDotsVertical className="ml-auto size-4" />
              ) : null}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {authData?.method === "tls" ? (
                    <IconCertificate className="m-auto" />
                  ) : (
                    <>
                      <AvatarImage
                        src={userData?.picture || ""}
                        alt={userData?.name || "user"}
                      />
                      <AvatarFallback className="rounded-lg">
                        {getAvatarInitials(
                          userData?.name || userData?.email
                        )}
                      </AvatarFallback>
                    </>
                  )}
                </Avatar>
                <div
                  className={`grid flex-1 text-left text-sm leading-tight ${authIsValidating ? 'animate-pulse' : ''
                    }`}
                >
                  {authData?.method === "tls" ? (
                    <>
                      <span
                        className={`truncate font-medium ${userIsValidating ? 'animate-pulse' : ''
                          }`}
                      >
                        {userData?.name}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {authData?.identifier?.slice(0, 12)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="truncate font-medium">
                        {userData?.name || "User"}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {userData?.email || ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconDeviceDesktop className="mr-2 size-4" />
                <span>Theme</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme('light')}>
                  <IconSun className="mr-2 size-4" />
                  <span>Light</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                  <IconMoon className="mr-2 size-4" />
                  <span>Dark</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')}>
                  <IconDeviceDesktop className="mr-2 size-4" />
                  <span>System</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {authData?.method == 'oidc' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <IconLogout />
                  Log out
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
