import yaml from 'js-yaml';

const type = process.argv[2];
const query = process.argv[3];

if (!type || !query) {
  console.error('Usage: bun run search.ts <type> <query>');
  console.error('Types: paths, definitions, responses');
  process.exit(1);
}

try {
  const response = await fetch('http://localhost:3001/documentation/rest-api.yaml');
  if (!response.ok) {
    throw new Error(`Failed to fetch spec: ${response.statusText}`);
  }
  const text = await response.text();
  const spec = yaml.load(text) as any;

  if (type === 'paths') {
    const matches = Object.keys(spec.paths).filter(p => p.includes(query));
    console.log(JSON.stringify(matches, null, 2));
  } else if (type === 'definitions') {
    const matches = Object.keys(spec.definitions).filter(d => d.toLowerCase().includes(query.toLowerCase()));
    console.log(JSON.stringify(matches, null, 2));
  } else if (type === 'responses') {
    const matches = Object.keys(spec.responses).filter(r => r.toLowerCase().includes(query.toLowerCase()));
    console.log(JSON.stringify(matches, null, 2));
  } else {
    console.error('Invalid type. Must be paths, definitions, or responses.');
    process.exit(1);
  }
} catch (e) {
  console.error('Error fetching or parsing spec:', e.message);
  process.exit(1);
}
