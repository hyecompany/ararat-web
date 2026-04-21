import yaml from 'js-yaml';

const method = process.argv[2]?.toLowerCase();
const path = process.argv[3];

if (!method || !path) {
  console.error('Usage: bun run get-endpoint.ts <method> <path>');
  process.exit(1);
}

try {
  const response = await fetch('http://localhost:3001/documentation/rest-api.yaml');
  if (!response.ok) {
    throw new Error(`Failed to fetch spec: ${response.statusText}`);
  }
  const text = await response.text();
  const spec = yaml.load(text) as any;

  const endpoint = spec.paths[path]?.[method];
  if (endpoint) {
    console.log(JSON.stringify(endpoint, null, 2));
  } else {
    console.error(`Endpoint ${method.toUpperCase()} ${path} not found.`);
    process.exit(1);
  }
} catch (e) {
  console.error('Error fetching or parsing spec:', e.message);
  process.exit(1);
}
