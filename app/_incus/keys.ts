function encodePart(value: string) {
  return encodeURIComponent(value);
}

export function instanceKey(project: string, name: string) {
  return `${encodePart(project)}/${encodePart(name)}`;
}

export function profileKey(project: string, name: string) {
  return `${encodePart(project)}/${encodePart(name)}`;
}

export function imageKey(project: string, fingerprint: string) {
  return `${encodePart(project)}/${encodePart(fingerprint)}`;
}

export function networkKey(project: string, name: string) {
  return `${encodePart(project)}/${encodePart(name)}`;
}

export function storageVolumeKey(project: string, type: string, name: string) {
  return `${encodePart(project)}/${encodePart(type)}/${encodePart(name)}`;
}

export function storageBucketKey(project: string, name: string) {
  return `${encodePart(project)}/${encodePart(name)}`;
}

export function splitStorageVolumeKey(key: string) {
  const [project = '', type = '', name = ''] = key.split('/').map(decodeURIComponent);
  return { project, type, name };
}

export function splitStorageBucketKey(key: string) {
  const [project = '', name = ''] = key.split('/').map(decodeURIComponent);
  return { project, name };
}
