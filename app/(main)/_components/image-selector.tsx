'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Row } from '@tanstack/react-table';

import { Badge } from 'ui-web/components/badge';
import { Button } from 'ui-web/components/button';
import DataTable from 'ui-web/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import { Spinner } from 'ui-web/components/spinner';
import { useImages } from '@/app/(main)/images/_hooks/images';
import { Image } from '@/app/(main)/images/_lib/images';
import ProjectsContext from '@/app/(main)/_context/projects';

type RemoteProtocol = 'simplestreams';

type RemoteServer = {
  server: string;
  protocol: RemoteProtocol;
};

type ImageKind = 'container' | 'virtual-machine';

type SimplestreamItem = {
  ftype?: string;
  path?: string;
};

type SimplestreamProduct = {
  aliases?: string | { name: string }[];
  arch?: string;
  os?: string;
  release?: string;
  variant?: string;
  versions?: Record<
    string,
    {
      items?: Record<string, SimplestreamItem>;
    }
  >;
};

export type SelectableImage = {
  id: string;
  local: boolean;
  label: string;
  os?: string;
  release?: string;
  variant?: string;
  arch?: string;
  types: ImageKind[];
  fingerprint?: string;
  remote?: {
    server: string;
    alias: string;
    protocol: 'simplestreams' | 'oci';
  };
};

export default function ImageSelector({
  selectedImage,
  onSelect,
  instanceType,
  project,
  projectLabel,
  emptyDescription = 'Select an image to define the instance base.',
  defaultSelection,
  disableAutoSelect = false,
}: {
  selectedImage: SelectableImage | null;
  onSelect: (image: SelectableImage) => void;
  instanceType?: 'virtual-machine' | 'container';
  project?: string | null;
  projectLabel?: string;
  emptyDescription?: string;
  defaultSelection?: {
    fingerprint?: string | null;
    alias?: string | null;
    description?: string | null;
  };
  disableAutoSelect?: boolean;
}) {
  const { currentProject } = use(ProjectsContext);
  const resolvedProject = project === undefined ? currentProject : project;
  const resolvedProjectLabel =
    projectLabel ??
    (resolvedProject === 'all'
      ? 'All projects'
      : resolvedProject
        ? `Project · ${resolvedProject}`
        : 'Project · default');
  const {
    data: localImagesData,
    isLoading,
    isValidating,
  } = useImages(resolvedProject);
  const [userAddedRemoteServers, setUserAddedRemoteServers] = useState<
    RemoteServer[]
  >([]);
  const [remoteImages, setRemoteImages] = useState<SelectableImage[]>([]);
  const [loadingRemotes, setLoadingRemotes] = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [remoteProtocol, setRemoteProtocol] = useState<'simplestreams' | 'oci'>(
    'simplestreams',
  );
  const [remoteURL, setRemoteURL] = useState('');
  const [ociImage, setOciImage] = useState('');
  const [stringFilter, setStringFilter] = useState('');
  const fetchedRemotesRef = useRef(new Set<string>());

  const localImages = useMemo<SelectableImage[]>(() => {
    if (!localImagesData) return [];
    return localImagesData.map((image: Image) => ({
      id: `local-${image.fingerprint}`,
      local: true,
      label:
        image.aliases?.[0]?.name ?? image.properties.os ?? image.fingerprint,
      os: image.properties.os,
      release: image.properties.release,
      variant: image.properties.variant,
      arch: image.architecture,
      types: image.type ? [image.type as ImageKind] : [],
      fingerprint: image.fingerprint,
    }));
  }, [localImagesData]);

  const derivedRemoteServers = useMemo<RemoteServer[]>(() => {
    if (!localImagesData) return [];
    const map = new Map<string, RemoteServer>();
    localImagesData.forEach((image: Image) => {
      const server = image.update_source?.server;
      if (!server || image.update_source?.protocol !== 'simplestreams') return;
      const normalized = normalizeRemoteURL(server);
      if (!normalized || map.has(normalized)) return;
      map.set(normalized, {
        server: normalized,
        protocol: 'simplestreams',
      });
    });
    return Array.from(map.values());
  }, [localImagesData]);

  const remoteServers = useMemo(() => {
    const map = new Map<string, RemoteServer>();
    [...derivedRemoteServers, ...userAddedRemoteServers].forEach((remote) => {
      const normalized = normalizeRemoteURL(remote.server);
      if (!normalized || map.has(normalized)) return;
      map.set(normalized, { server: normalized, protocol: 'simplestreams' });
    });
    return Array.from(map.values());
  }, [derivedRemoteServers, userAddedRemoteServers]);

  useEffect(() => {
    const serversToFetch = remoteServers.filter(
      (remote) => !fetchedRemotesRef.current.has(remote.server),
    );
    if (!serversToFetch.length) return;
    let cancelled = false;
    const fetchRemotes = async () => {
      setLoadingRemotes(true);
      try {
        for (const remote of serversToFetch) {
          try {
            const remoteImagesForServer = await fetchSimplestreamImages(remote);
            if (cancelled) return;
            fetchedRemotesRef.current.add(remote.server);
            setRemoteImages((prev) =>
              mergeImageLists(prev, remoteImagesForServer),
            );
          } catch (error) {
            console.error(
              'Unable to fetch remote images',
              remote.server,
              error,
            );
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingRemotes(false);
        }
      }
    };
    fetchRemotes();
    return () => {
      cancelled = true;
    };
  }, [remoteServers]);

  const images = useMemo(() => {
    const allImages = [...localImages, ...remoteImages];
    if (!instanceType) return allImages;
    return allImages.filter((image) => image.types.includes(instanceType));
  }, [instanceType, localImages, remoteImages]);
  const defaultMatchedImage = useMemo(() => {
    if (!localImages.length || !defaultSelection) {
      return null;
    }

    const normalizedAlias = defaultSelection.alias?.trim().toLowerCase();
    const normalizedDescription = defaultSelection.description
      ?.trim()
      .toLowerCase();

    return (
      localImages.find(
        (image) =>
          defaultSelection.fingerprint &&
          image.fingerprint === defaultSelection.fingerprint,
      ) ??
      localImages.find((image) => {
        if (!normalizedAlias) return false;
        const labels = [image.label, image.os]
          .filter(Boolean)
          .map((value) => value!.trim().toLowerCase());
        return labels.some((value) => value === normalizedAlias);
      }) ??
      localImages.find((image) => {
        if (!normalizedDescription) return false;
        const haystacks = [
          image.label,
          image.os,
          [image.os, image.release].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .map((value) => value!.trim().toLowerCase());
        return haystacks.some((value) => normalizedDescription.includes(value));
      }) ??
      null
    );
  }, [defaultSelection, localImages]);
  const displayedImage = selectedImage ?? defaultMatchedImage;
  const selectedImageId = displayedImage?.id ?? null;

  useEffect(() => {
    if (disableAutoSelect || selectedImage || !defaultMatchedImage) {
      return;
    }

    onSelect(defaultMatchedImage);
  }, [defaultMatchedImage, disableAutoSelect, onSelect, selectedImage]);

  const handleSelect = useCallback(
    (image: SelectableImage) => {
      onSelect(image);
    },
    [onSelect],
  );

  const handleRowClick = useCallback(
    (row: Row<object>) => {
      handleSelect(row.original as SelectableImage);
    },
    [handleSelect],
  );

  const handleAddRemote = () => {
    const normalized = normalizeRemoteURL(remoteURL);
    if (!normalized) return;
    if (remoteProtocol === 'simplestreams') {
      setUserAddedRemoteServers((prev) => {
        if (prev.some((remote) => remote.server === normalized)) return prev;
        return [...prev, { server: normalized, protocol: 'simplestreams' }];
      });
    } else if (remoteProtocol === 'oci' && ociImage) {
      const ociEntry = buildOciImage(normalized, ociImage);
      setRemoteImages((prev) => [
        ociEntry,
        ...prev.filter((image) => image.id !== ociEntry.id),
      ]);
    }
    setRemoteURL('');
    setOciImage('');
    setAddingRemote(false);
  };

  const columns = useMemo(
    () => [
      {
        header: 'Image',
        accessorKey: 'label',
        cell: ({ row }: { row: Row<object> }) => {
          const image = row.original as SelectableImage;
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold" title={image.os}>
                  {image.os ?? 'Unknown OS'}
                  {image.release ? ` ${image.release}` : ''}
                </span>
                <Badge
                  variant={image.local ? 'secondary' : 'outline'}
                  className="shrink-0 text-[10px] uppercase"
                >
                  {image.local ? 'Local' : 'Remote'}
                </Badge>
              </div>
              <span
                className="truncate text-xs text-muted-foreground"
                title={image.label}
              >
                {image.label}
              </span>
              {!image.local && image.remote?.server ? (
                <span
                  className="truncate text-[10px] text-muted-foreground"
                  title={formatSource(image.remote.server)}
                >
                  {formatSource(image.remote.server)}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        header: 'Type',
        id: 'types',
        cell: ({ row }: { row: Row<object> }) => {
          const image = row.original as SelectableImage;
          const typeText = image.types.length
            ? image.types
                .map((type) =>
                  type === 'virtual-machine' ? 'Virtual Machine' : 'Container',
                )
                .join(', ')
            : '—';
          return (
            <div className="truncate" title={typeText}>
              {typeText}
            </div>
          );
        },
      },
      {
        header: 'Architecture',
        accessorKey: 'arch',
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const arch = getValue() as string | undefined;
          return (
            <div className="truncate" title={arch}>
              {arch ?? '—'}
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="mt-2 flex h-full min-h-0 flex-col space-y-4 overflow-hidden">
      {isLoading ? <Spinner className="mx-auto my-6" /> : null}
      {!isLoading ? (
        <>
          <div className="shrink-0 rounded-md border bg-muted/30 p-3 text-sm">
            {displayedImage ? (
              <>
                <p className="font-medium">
                  {displayedImage.os ?? 'Unknown OS'}
                  {displayedImage.release ? ` · ${displayedImage.release}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {displayedImage.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {displayedImage.remote
                    ? `${formatProtocol(
                        displayedImage.remote.protocol,
                      )} · ${formatSource(displayedImage.remote.server)}`
                    : 'Local image'}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{emptyDescription}</p>
            )}
          </div>
          <div className="shrink-0 flex flex-wrap items-center gap-3">
            <div>
              <p className="my-auto text-md font-medium">Available Images</p>
              <p className="text-xs text-muted-foreground">
                {resolvedProjectLabel}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-fit">
              <Input
                placeholder="Search images..."
                value={stringFilter}
                onChange={(event) => setStringFilter(event.currentTarget.value)}
                className="h-9 w-40 sm:w-64"
              />
              <Dialog open={addingRemote} onOpenChange={setAddingRemote}>
                <DialogTrigger asChild>
                  <Button className="ml-auto h-fit" variant="outline">
                    Add Remote
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Remote</DialogTitle>
                    <DialogDescription>
                      Add a Simplestreams server or OCI image to pull from.
                    </DialogDescription>
                  </DialogHeader>
                  <Label htmlFor="remoteProtocol">Remote Type</Label>
                  <div className="-mt-2 flex gap-2" id="remoteProtocol">
                    <Select
                      value={remoteProtocol}
                      onValueChange={(value) =>
                        setRemoteProtocol(value as 'simplestreams' | 'oci')
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Remote Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simplestreams">
                          Simplestreams
                        </SelectItem>
                        <SelectItem value="oci">OCI</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="https://images.example.com"
                      value={remoteURL}
                      onChange={(event) => setRemoteURL(event.target.value)}
                    />
                  </div>
                  {remoteProtocol === 'oci' ? (
                    <>
                      <Label htmlFor="ociImage">OCI Image</Label>
                      <Input
                        id="ociImage"
                        value={ociImage}
                        onChange={(event) => setOciImage(event.target.value)}
                        placeholder="alias"
                        className="-mt-2"
                      />
                    </>
                  ) : null}
                  <DialogFooter>
                    <Button
                      disabled={
                        !remoteURL ||
                        (remoteProtocol === 'oci' && !ociImage.trim().length)
                      }
                      onClick={handleAddRemote}
                    >
                      {remoteProtocol === 'oci'
                        ? 'Add OCI Image'
                        : 'Add Remote Server'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div
            className={`mt-2 min-h-0 flex-1 overflow-hidden ${
              isValidating || loadingRemotes ? 'animate-pulse' : ''
            }`}
          >
            <DataTable
              className="h-full [&>div]:h-full [&>div]:overflow-hidden [&>div>div]:h-full"
              stringFilter={stringFilter}
              cols={columns}
              data={images}
              disablePagination
              onRowClick={handleRowClick}
              getRowClassName={(row) =>
                (row.original as SelectableImage).id === selectedImageId
                  ? 'bg-accent/40 hover:bg-accent/40'
                  : ''
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function normalizeRemoteURL(url: string) {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function mergeImageLists(
  current: SelectableImage[],
  incoming: SelectableImage[],
) {
  const map = new Map<string, SelectableImage>();
  current.forEach((image) => map.set(image.id, image));
  incoming.forEach((image) => map.set(image.id, image));
  return Array.from(map.values());
}

async function fetchSimplestreamImages(remote: RemoteServer) {
  const base = remote.server;
  const indexRes = await fetch(`${base}/streams/v1/index.json`);
  if (!indexRes.ok) {
    throw new Error(`Unable to fetch index from ${base}`);
  }
  const indexJson = await indexRes.json();
  const imagesPath = indexJson.index?.images?.path ?? 'streams/v1/images.json';
  const path = imagesPath.startsWith('http')
    ? imagesPath
    : `${base}/${imagesPath.replace(/^\//, '')}`;
  const imagesRes = await fetch(path);
  if (!imagesRes.ok) {
    throw new Error(`Unable to fetch images from ${base}`);
  }
  const imagesJson = await imagesRes.json();
  const products = (imagesJson.products ?? {}) as Record<
    string,
    SimplestreamProduct
  >;
  const remoteImages: SelectableImage[] = [];
  Object.entries(products).forEach(([key, product]) => {
    const alias = extractPrimaryAlias(product.aliases) ?? key;
    const versionKey = selectLatestVersion(product.versions);
    const versionItems: Record<string, SimplestreamItem> | undefined =
      versionKey ? product.versions?.[versionKey]?.items : undefined;
    const types = deriveImageTypes(versionItems);
    remoteImages.push({
      id: `remote-${base}-${alias}-${product.arch ?? ''}-${product.variant ?? ''}`,
      local: false,
      label: alias,
      os: product.os,
      release: product.release,
      variant: product.variant,
      arch: product.arch === 'amd64' ? 'x86_64' : product.arch,
      types,
      remote: {
        server: base,
        alias,
        protocol: 'simplestreams',
      },
    });
  });
  return remoteImages;
}

function extractPrimaryAlias(aliases?: unknown) {
  if (!aliases) return undefined;
  if (Array.isArray(aliases)) {
    return aliases[0]?.name;
  }
  if (typeof aliases === 'string') {
    return aliases.split(',')[0];
  }
  return undefined;
}

function selectLatestVersion(versions?: Record<string, unknown>) {
  if (!versions) return null;
  return Object.keys(versions).sort().at(-1) ?? null;
}

function deriveImageTypes(items?: Record<string, SimplestreamItem>) {
  if (!items) return [];
  const values = Object.values(items);
  const types = new Set<ImageKind>();
  const containerMatch = values.some((item) =>
    ['squashfs', 'lxd', 'rootfs'].some(
      (token) =>
        (item.ftype ?? '').includes(token) || (item.path ?? '').includes(token),
    ),
  );
  if (containerMatch) {
    types.add('container');
  }
  const vmMatch = values.some((item) =>
    ['disk', 'qcow', 'uefi'].some(
      (token) =>
        (item.ftype ?? '').includes(token) || (item.path ?? '').includes(token),
    ),
  );
  if (vmMatch) {
    types.add('virtual-machine');
  }
  return Array.from(types);
}

function buildOciImage(server: string, alias: string): SelectableImage {
  const trimmedAlias = alias.trim();
  return {
    id: `oci-${server}-${trimmedAlias}`,
    local: false,
    label: trimmedAlias,
    os: trimmedAlias,
    types: ['container', 'virtual-machine'],
    remote: {
      server,
      alias: trimmedAlias,
      protocol: 'oci',
    },
  };
}

function formatProtocol(protocol: 'simplestreams' | 'oci') {
  return protocol === 'simplestreams' ? 'Simplestreams' : 'OCI';
}

function formatSource(server?: string) {
  if (!server) return 'Remote';
  try {
    const parsed = new URL(server);
    return parsed.hostname;
  } catch {
    return server;
  }
}
