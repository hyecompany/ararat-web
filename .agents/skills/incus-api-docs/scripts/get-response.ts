import yaml from 'js-yaml';

const name = process.argv[2];

if (!name) {
  console.error('Usage: bun run get-response.ts <name>');
  process.exit(1);
}

try {
  const response = await fetch('http://localhost:3001/documentation/rest-api.yaml');
  if (!response.ok) {
    throw new Error(`Failed to fetch spec: ${response.statusText}`);
  }
  const text = await response.text();
  const spec = yaml.load(text) as any;

  const res = spec.responses[name];
  if (res) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.error(`Response ${name} not found.`);
    process.exit(1);
  }
} catch (e) {
  console.error('Error fetching or parsing spec:', e.message);
  process.exit(1);
}
